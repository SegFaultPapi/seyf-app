import twilio from "twilio";

// In a real app we'd get these from secrets or config
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

export async function sendOtpViaSms(phone: string, code: string): Promise<void> {
  if (!twilioClient) {
    console.log(`[MOCK SMS] Sending OTP ${code} to ${phone}`);
    return;
  }
  
  await twilioClient.messages.create({
    body: `Tu código de verificación Seyf es: ${code}`,
    from: process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID,
    to: phone,
  });
}

export async function sendOtpViaEmail(email: string, code: string): Promise<void> {
  console.log(`[MOCK EMAIL] Sending OTP ${code} to ${email}`);
  // fallback email logic
}

export async function deliverOtp(phone: string, email: string, code: string): Promise<void> {
  try {
    await sendOtpViaSms(phone, code);
    console.log(`OTP delivered via SMS to ${phone}`);
  } catch (error) {
    console.error(`SMS failed for ${phone}, falling back to email`, error);
    await sendOtpViaEmail(email, code);
    console.log(`OTP delivered via Email to ${email}`);
  }
}
