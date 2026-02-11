import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ILI Alignment Platform',
  description: 'Pipeline ILI run alignment and growth analytics'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen bg-slate-100">
            <div className="grid min-h-screen grid-cols-1 md:grid-cols-[300px_1fr]">
              <aside className="border-r border-slate-800 bg-slate-900 text-slate-200">
                <div className="px-6 py-6">
                  <p className="text-sm font-semibold uppercase tracking-wider text-cyan-300">ILI Data Alignment</p>
                  <h1 className="mt-2 text-2xl font-semibold text-white">Engineer Console</h1>
                </div>
                <nav className="space-y-1 px-4">
                  <Link className="block rounded-md px-4 py-3 text-lg hover:bg-slate-800" href="/">
                    Home
                  </Link>
                  <Link className="block rounded-md px-4 py-3 text-lg hover:bg-slate-800" href="/dashboard">
                    Dashboard
                  </Link>
                  <Link className="block rounded-md px-4 py-3 text-lg hover:bg-slate-800" href="/upload">
                    Upload
                  </Link>
                  {!session && (
                    <>
                      <Link className="block rounded-md px-4 py-3 text-lg hover:bg-slate-800" href="/login">
                        Login
                      </Link>
                      <Link className="block rounded-md px-4 py-3 text-lg hover:bg-slate-800" href="/register">
                        Register
                      </Link>
                    </>
                  )}
                </nav>
                <div className="px-6 py-6 text-sm text-slate-400">
                  {session ? `Signed in: ${session.user.email}` : 'Not authenticated'}
                </div>
              </aside>
              <main className="p-8">{children}</main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
