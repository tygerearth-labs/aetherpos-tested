import type { NextAuthOptions } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import NextAuth from 'next-auth';

export const authOptions: NextAuthOptions = {
  // Only use secure cookies when actually on HTTPS
  useSecureCookies: !!process.env.NEXTAUTH_URL?.startsWith('https'),
  providers: [
    Credentials({
      id: 'credentials',
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password are required');
        }

        const user = await db.user.findFirst({
          where: { email: credentials.email },
          include: { outlet: true },
        });

        if (!user) {
          throw new Error('No user found with this email');
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!isPasswordValid) {
          throw new Error('Invalid password');
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          outletId: user.outletId,
        };
      },
    }),
    Credentials({
      id: 'webmaster-credentials',
      name: 'Webmaster Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password are required');
        }

        const webmaster = await db.webmaster.findUnique({
          where: { email: credentials.email },
        });

        if (!webmaster) {
          throw new Error('No webmaster found with this email');
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          webmaster.password
        );

        if (!isPasswordValid) {
          throw new Error('Invalid password');
        }

        return {
          id: webmaster.id,
          name: webmaster.name,
          email: webmaster.email,
          role: 'WEBMASTER',
          outletId: '__webmaster__',
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days — prevent premature session expiry during offline
  },
  jwt: {
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as Record<string, unknown>).role;
        token.outletId = (user as Record<string, unknown>).outletId;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as Record<string, unknown>).role = token.role;
        (session.user as Record<string, unknown>).outletId = token.outletId;
        session.user.name = token.name as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/',
  },
};

export default NextAuth(authOptions);
