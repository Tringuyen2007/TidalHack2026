import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { User } from '@/lib/db/models';

type AuthUserRecord = {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password_hash: string;
  org_id: Types.ObjectId;
};

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login'
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        await connectToDatabase();
        const user = await User.findOne({ email: credentials.email.toLowerCase() }).lean<AuthUserRecord | null>();
        if (!user) {
          return null;
        }

        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) {
          return null;
        }

        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          orgId: user.org_id.toString()
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.orgId = user.orgId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub && token.orgId) {
        session.user.id = token.sub;
        session.user.orgId = token.orgId;
      }
      return session;
    }
  }
};
