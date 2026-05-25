import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { validateEmail, validatePassword } from '@/lib/api-helpers';
import { safeJsonCreated, safeJsonError } from '@/lib/safe-response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { outletName, ownerName, email, password } = body;

    // Validate required fields
    if (!outletName || !ownerName || !email || !password) {
      return safeJsonError('All fields are required', 400);
    }

    const emailErr = validateEmail(email);
    if (emailErr) return safeJsonError(emailErr, 400);

    const passwordErr = validatePassword(password);
    if (passwordErr) return safeJsonError(passwordErr, 400);

    // Check if email already exists (use findFirst since email is part of compound unique [email, outletId])
    const existingUser = await db.user.findFirst({ where: { email } });
    if (existingUser) {
      return safeJsonError('Email already registered', 409);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // All new outlets start with free plan
    const finalAccountType = 'free';

    // Create outlet + owner in transaction
    const result = await db.$transaction(async (tx) => {
      const outlet = await tx.outlet.create({
        data: {
          name: outletName,
          accountType: finalAccountType,
        },
      });

      // Create default outlet settings
      await tx.outletSetting.create({
        data: {
          outletId: outlet.id,
          paymentMethods: 'CASH,QRIS',
          loyaltyEnabled: true,
          loyaltyPointsPerAmount: 10000,
          loyaltyPointValue: 100,
          receiptBusinessName: outletName,
          receiptAddress: '',
          receiptPhone: '',
          receiptFooter: 'Terima kasih atas kunjungan Anda!',
          receiptLogo: '',
          themePrimaryColor: 'emerald',
        },
      });

      const user = await tx.user.create({
        data: {
          name: ownerName,
          email,
          password: hashedPassword,
          role: 'OWNER',
          outletId: outlet.id,
        },
      });

      return { outlet, user };
    });

    return safeJsonCreated({
      message: 'Registration successful',
      outletId: result.outlet.id,
      userId: result.user.id,
      accountType: finalAccountType,
    });
  } catch (error) {
    console.error('Registration error:', error);
    return safeJsonError('Internal server error');
  }
}
