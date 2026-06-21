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
        token.role = user.role;
        token.outletId = user.outletId;
        token.name = user.name;

        // Build outletIds list
        const outletIds: string[] = [user.outletId];

        if (user.role === 'OWNER') {
          // OWNER: include all outlets linked by owner records with same email
          const ownerRecords = await db.user.findMany({
            where: { email: user.email!, role: 'OWNER' },
            select: { outletId: true },
          });
          for (const rec of ownerRecords) {
            if (!outletIds.includes(rec.outletId)) {
              outletIds.push(rec.outletId);
            }
          }
        } else {
          // CREW: include outlets from UserOutlet records
          const crewOutlets = await db.userOutlet.findMany({
            where: { userId: user.id },
            select: { outletId: true },
          });
          for (const rec of crewOutlets) {
            if (!outletIds.includes(rec.outletId)) {
              outletIds.push(rec.outletId);
            }
          }
        }

        token.outletIds = outletIds;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.outletId = token.outletId;
        session.user.name = token.name;
        session.user.outletIds = token.outletIds;
      }
      return session;
    },
  },
  pages: {
    signIn: '/',
  },
};

export default NextAuth(authOptions);
