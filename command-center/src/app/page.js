'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import * as Ably from 'ably';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mihdhrwxcoamyjqchtdv.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'your-anon-key';
const ABLY_API_KEY = process.env.NEXT_PUBLIC_ABLY_API_KEY || 'your-ably-key';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function Home() {
  const [machines, setMachines] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [commandInput, setCommandInput] = useState('');
  const [realtimeLogs, setRealtimeLogs] = useState([]);
  const [ablyClient, setAblyClient] = useState(null);

  useEffect(() => {
    fetchMachines();
    fetchTasks();

    // Use token-based auth or api key for Ably
    const client = new Ably.Realtime({ key: ABLY_API_KEY });
    client.connection.on('connected', () => {
      console.log('Connected to Ably');
    });

    const channel = client.channels.get('fleet:default-fleet');
    channel.subscribe('task_log', (msg) => {
      setRealtimeLogs((prev) => [...prev, `${msg.data.task_id}: ${msg.data.log}`]);
    });
    channel.subscribe('task_completed', (msg) => {
      setRealtimeLogs((prev) => [...prev, `[COMPLETE] Task ${msg.data.task_id} status: ${msg.data.status}`]);
      fetchTasks();
    });

    setAblyClient(client);

    // Also poll machines/tasks to keep state fresh
    const interval = setInterval(() => {
        fetchMachines();
        fetchTasks();
    }, 5000);

    return () => {
      client.close();
      clearInterval(interval);
    };
  }, []);

  const fetchMachines = async () => {
    const { data } = await supabase.from('machines').select('*, kaggle_accounts(username)').order('created_at', { ascending: false });
    if (data) setMachines(data);
  };

  const fetchTasks = async () => {
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (data) setTasks(data);
  };

  const dispatchTask = async () => {
    if (!commandInput) return;
    const { data, error } = await supabase.from('tasks').insert([
      { title: 'Manual Command', command: commandInput, status: 'pending' }
    ]).select();

    if (error) {
        console.error("Error dispatching task:", error);
    } else {
        setCommandInput('');
        fetchTasks();
    }
  };

  const sendDirectCommand = async (ablyClientId) => {
    if (!commandInput || !ablyClient) return;
    const channel = ablyClient.channels.get(`machines:${ablyClientId}`);
    channel.publish('command', { command: commandInput });
    setRealtimeLogs((prev) => [...prev, `[DIRECT TO ${ablyClientId}]: ${commandInput}`]);
    setCommandInput('');
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 font-sans">
      <h1 className="text-3xl font-bold text-gray-800">Kaggle Cluster Orchestrator</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="border p-4 rounded-lg shadow-sm bg-white">
          <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h2 className="text-xl font-semibold text-gray-700">Active Machines</h2>
              <button onClick={fetchMachines} className="text-sm bg-blue-50 text-blue-600 px-3 py-1 rounded hover:bg-blue-100 transition">Refresh</button>
          </div>
          <ul className="space-y-3">
            {machines.map((m) => {
              const isOnline = new Date() - new Date(m.last_ping) < 15000; // 15 seconds threshold
              return (
              <li key={m.id} className="flex justify-between items-center bg-gray-50 p-3 rounded border border-gray-100 shadow-sm">
                <div>
                  <div className="flex items-center">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    <strong className="text-gray-800">{m.kaggle_accounts?.username || 'Unknown'}</strong>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 ml-4 border bg-gray-200 inline-block px-1 rounded">
                    ID: {m.ably_client_id.substring(0,8)}...
                  </div>
                </div>
                <button
                  onClick={() => sendDirectCommand(m.ably_client_id)}
                  disabled={!isOnline}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition ${isOnline ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                >
                  Direct Cmd
                </button>
              </li>
            )})}
            {machines.length === 0 && <li className="text-gray-500 italic text-center py-4">No machines active.</li>}
          </ul>
        </section>

        <section className="border p-4 rounded-lg shadow-sm bg-white">
          <div className="flex justify-between items-center mb-4 border-b pb-2">
            <h2 className="text-xl font-semibold text-gray-700">Distributed Task Queue</h2>
            <button onClick={fetchTasks} className="text-sm bg-blue-50 text-blue-600 px-3 py-1 rounded hover:bg-blue-100 transition">Refresh</button>
          </div>
          <ul className="space-y-2 max-h-64 overflow-y-auto pr-2">
            {tasks.map((t) => (
              <li key={t.id} className="bg-gray-50 p-3 rounded text-sm border border-gray-100 flex flex-col shadow-sm">
                <div className="flex justify-between items-center">
                  <strong className="text-gray-800">{t.title}</strong>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.status === 'completed' ? 'bg-green-100 text-green-700' : t.status === 'failed' ? 'bg-red-100 text-red-700' : t.status === 'running' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {t.status}
                  </span>
                </div>
                <code className="text-xs bg-gray-800 text-green-400 p-2 mt-2 rounded block break-all font-mono">{t.command}</code>
              </li>
            ))}
            {tasks.length === 0 && <li className="text-gray-500 italic text-center py-4">Queue is empty.</li>}
          </ul>
        </section>
      </div>

      <section className="border p-4 rounded-lg shadow-sm bg-white">
        <h2 className="text-xl font-semibold mb-4 border-b pb-2 text-gray-700">Terminal & Dispatch</h2>
        <div className="flex space-x-2 mb-4">
          <input
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            className="flex-1 border-2 border-gray-200 focus:border-indigo-500 outline-none p-3 rounded font-mono text-sm transition"
            placeholder="e.g., echo 'Hello Cluster' && sleep 2 && ls -la"
            onKeyDown={(e) => e.key === 'Enter' && dispatchTask()}
          />
          <button onClick={dispatchTask} className="bg-indigo-600 text-white px-6 py-2 rounded font-semibold hover:bg-indigo-700 transition shadow-sm">
            Enqueue
          </button>
        </div>

        <div className="bg-gray-900 text-green-400 font-mono text-sm p-4 rounded-lg h-80 overflow-y-auto shadow-inner leading-relaxed">
          {realtimeLogs.length === 0 && <div className="text-gray-500 italic">Waiting for terminal output from workers...</div>}
          {realtimeLogs.map((log, i) => (
            <div key={i} className="mb-1">{log}</div>
          ))}
        </div>
      </section>
    </div>
  );
}
