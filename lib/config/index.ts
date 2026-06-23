export const config = {
  otp: {
    expiryMinutes: 5,
    resendRateLimit: {
      maxAttempts: 3,
      windowHours: 1,
    },
  },
  auth: {
    bcryptRounds: 12,
    jwt: {
      accessExpiresIn: "15m",
      refreshExpiresIn: "7d",
    },
  },
};
