import asyncio
import os
import uuid
import sys
from ably import AblyRealtime
from supabase import create_client, Client

# Environment Variables Config
ABLY_KEY = os.getenv("ABLY_API_KEY", "your-ably-key") # The one provided by user
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://mihdhrwxcoamyjqchtdv.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "your-supabase-key")
KAGGLE_USERNAME = os.getenv("KAGGLE_USERNAME", "test-user")
FLEET_NAME = os.getenv("FLEET_NAME", "default-fleet")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
WORKER_ID = str(uuid.uuid4())
MACHINE_ID = None

async def execute_task(task_id: str, command: str, ably_channel):
    """Executes a bash command/script asynchronously, streams output to Ably, and saves result."""
    print(f"[{WORKER_ID}] Started task: {task_id}")

    # Mark task as running in DB
    supabase.table("tasks").update({"status": "running", "assigned_machine_id": MACHINE_ID}).eq("id", task_id).execute()

    # Send start signal
    await ably_channel.publish('task_started', {'task_id': task_id, 'command': command})

    # Execute as Subprocess asynchronously and stream output
    process = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT
    )

    logs = ""
    while True:
        line = await process.stdout.readline()
        if not line:
            break

        decoded_line = line.decode('utf-8', errors='replace')
        logs += decoded_line
        print(decoded_line, end="")

        # Stream log to Ably realtime
        await ably_channel.publish('task_log', {'task_id': task_id, 'log': decoded_line.strip()})

    await process.wait()
    return_code = process.returncode

    status = "completed" if return_code == 0 else "failed"

    # Update task in DB
    supabase.table("tasks").update({"status": status, "result_logs": logs}).eq("id", task_id).execute()

    # Send completion signal
    await ably_channel.publish('task_completed', {'task_id': task_id, 'status': status, 'code': return_code})
    print(f"[{WORKER_ID}] Finished task: {task_id} with status: {status}")

async def listen_for_commands(ably_client: AblyRealtime):
    """Listens for direct commands on Ably"""
    channel = ably_client.channels.get(f"machines:{WORKER_ID}")

    def on_message(message):
        cmd = message.data.get('command')
        if cmd:
            print(f"Received realtime command: {cmd}")
            # Fire and forget execution for direct commands (like a terminal)
            asyncio.create_task(execute_task("realtime-cmd", cmd, channel))

    await channel.subscribe(on_message)
    print(f"[{WORKER_ID}] Listening for direct commands on Ably channel machines:{WORKER_ID}")

async def main():
    global MACHINE_ID

    # 1. Connect to Ably
    ably = AblyRealtime(ABLY_KEY)
    await ably.connection.once_async('connected')
    print(f"[{WORKER_ID}] Connected to Ably Realtime.")

    # 2. Register Machine in Supabase
    # Check if account exists, for MVP we just use username
    account_res = supabase.table("kaggle_accounts").select("id").eq("username", KAGGLE_USERNAME).execute()

    if len(account_res.data) == 0:
        print("Account not found, registering for testing...")
        acc = supabase.table("kaggle_accounts").insert({"username": KAGGLE_USERNAME, "api_key": "test"}).execute()
        account_id = acc.data[0]['id']
    else:
        account_id = account_res.data[0]['id']

    machine_res = supabase.table("machines").insert({
        "account_id": account_id,
        "ably_client_id": WORKER_ID,
        "status": "online"
    }).execute()

    MACHINE_ID = machine_res.data[0]['id']
    print(f"[{WORKER_ID}] Registered machine in DB with ID: {MACHINE_ID}")

    # 3. Listen for commands via Ably
    await listen_for_commands(ably)

    # 4. Long polling loop for distributed task queue
    try:
        while True:
            # Look for pending tasks
            tasks_res = supabase.table("tasks").select("*").eq("status", "pending").limit(1).execute()

            if tasks_res.data:
                task = tasks_res.data[0]
                # Claim the task (basic locking) - In a real prod this needs better concurrency control
                claim = supabase.table("tasks").update({"status": "running"}).eq("id", task['id']).eq("status", "pending").execute()

                if len(claim.data) > 0:
                    # We successfully claimed it
                    channel = ably.channels.get(f"fleet:{FLEET_NAME}")
                    # Dispatch to event loop so we don't block the polling entirely if it takes too long
                    asyncio.create_task(execute_task(task['id'], task['command'], channel))

            # Send heartbeat
            supabase.table("machines").update({"last_ping": "now()"}).eq("id", MACHINE_ID).execute()
            await asyncio.sleep(5) # Poll every 5 seconds

    except KeyboardInterrupt:
        print("Worker shutting down...")
    finally:
        supabase.table("machines").update({"status": "offline"}).eq("id", MACHINE_ID).execute()
        await ably.close()

if __name__ == "__main__":
    asyncio.run(main())
