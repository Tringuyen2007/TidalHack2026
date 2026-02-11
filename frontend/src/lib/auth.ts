"use client";

/* ------------------------------------------------------------------ */
/*  Auth helpers — talks to backend NextAuth via the Next.js rewrite  */
/* ------------------------------------------------------------------ */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  orgId: string;
}

export interface Session {
  user: SessionUser;
  expires: string;
}

/** Fetch the current NextAuth session (returns null if not logged in). */
export async function getSession(): Promise<Session | null> {
  try {
    const res = await fetch("/api/auth/session");
    const data = await res.json();
    if (data?.user?.email) return data as Session;
    return null;
  } catch {
    return null;
  }
}

/** Log in via backend NextAuth credentials provider. */
export async function login(
  email: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    // 1 — grab CSRF token (sets next-auth.csrf-token cookie)
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();

    // 2 — POST to NextAuth callback
    const res = await fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrfToken,
        email,
        password,
        json: "true",
      }),
      redirect: "follow",
    });

    // 3 — verify session was created
    const session = await getSession();
    if (session?.user) return { ok: true };

    // Check response for error indicator
    if (!res.ok) return { ok: false, error: "Invalid email or password" };
    return { ok: false, error: "Invalid email or password" };
  } catch {
    return { ok: false, error: "Login failed" };
  }
}

/** Log out via NextAuth. */
export async function logout(): Promise<void> {
  try {
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();

    await fetch("/api/auth/signout", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, json: "true" }),
    });
  } catch {
    // best-effort
  }
}

/** Register a new user via backend /api/auth/register. */
export async function register(data: {
  name: string;
  email: string;
  password: string;
  orgName: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error || "Registration failed" };
    return { ok: true, id: json.id };
  } catch {
    return { ok: false, error: "Registration failed" };
  }
}
