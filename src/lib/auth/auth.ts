import type { NextAuthOptions } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import NextAuth from 'next-auth';
import { checkPlanExpiry, downgradeExpiredPlan } from '@/lib/plan-expiry';
import { safeAuditLog } from '@/lib/safe-audit';

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

        try {
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

          // ---- Plan Expiry Check ----
          const expiryStatus = await checkPlanExpiry(user.outletId);

          if (expiryStatus.status === 'expired_branch') {
            // Branch outlet expired → block login
            throw new Error('PLAN_EXPIRED_BRANCH');
          }

          if (expiryStatus.status === 'expired_main') {
            // Main outlet expired → auto-downgrade to free, allow login
            await downgradeExpiredPlan(user.outletId);
          }

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            outletId: user.outletId,
          };
        } catch (err) {
          // AUDIT-3-001 FIX: Log FAILED login attempts so the audit trail can
          // answer "who tried to log in and failed?". We log BEFORE re-throwing.
          // We don't have a confirmed userId here (auth failed), so we use the
          // email as entityId for traceability and 'UNKNOWN' as userId.
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          if (errMsg !== 'PLAN_EXPIRED_BRANCH') {
            try {
              // Attempt to resolve outletId from email for scoping (best-effort)
              const attemptedUser = await db.user.findFirst({
                where: { email: credentials.email },
                select: { id: true, outletId: true, name: true },
              });
              await safeAuditLog({
                action: 'LOGIN_FAILED',
                entityType: 'USER',
                entityId: attemptedUser?.id || credentials.email,
                details: JSON.stringify({
                  email: credentials.email,
                  userName: attemptedUser?.name || null,
                  reason: errMsg,
                  timestamp: new Date().toISOString(),
                }),
                outletId: attemptedUser?.outletId || 'unknown',
                userId: attemptedUser?.id || 'unknown',
              });
            } catch { /* audit is best-effort */ }
          }
          console.error('[auth.authorize] Error:', errMsg);
          throw err;
        }
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
        // AUDIT-3-001 FIX: Log successful login. The jwt callback fires with
        // `user` ONLY on the initial sign-in (not on subsequent token refreshes),
        // so this records exactly one LOGIN_SUCCESS per session creation.
        // Uses safeAuditLog so an audit failure never blocks login.
        await safeAuditLog({
          action: 'LOGIN_SUCCESS',
          entityType: 'USER',
          entityId: user.id,
          details: JSON.stringify({
            email: user.email,
            userName: user.name,
            role: user.role,
            timestamp: new Date().toISOString(),
          }),
          outletId: user.outletId,
          userId: user.id,
        }).catch(() => { /* best-effort */ });
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.outletId = token.outletId;
        session.user.name = token.name;
      }
      return session;
    },
  },
  pages: {
    signIn: '/',
  },
};

export default NextAuth(authOptions);
