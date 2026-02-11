import { type DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      orgId: string;
    };
  }

  interface User {
    orgId: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    orgId?: string;
  }
}
