import './globals.css'

export const metadata = {
  title: 'Kaggle Cluster Orchestrator',
  description: 'Manage fleets of Kaggle machines',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
