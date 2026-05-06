require("dotenv").config();

// ✅ API endpoint (backend URL)
const EMAIL_API_ENDPOINT = process.env.EMAIL_API_ENDPOINT;

// ✅ Send email via your backend API (NO credentials here)
const sendEmailViaAPI = async (mailOptions) => {
  try {
    const response = await fetch(EMAIL_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mailOptions }), // ✅ ONLY mailOptions
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Email API error");
    }

    return result;

  } catch (error) {
    console.error("Email sending failed:", error.message);
    throw new Error("Failed to send email");
  }
};

// ✅ Verification email function
const sendVerificationEmail = async (email, verificationToken) => {
  const verifyLink = `${process.env.BASE_URL}verify-email?token=${verificationToken}`;
  console.log(process.env.BASE_URL, verificationToken, process.env.COMPANY_NAME, process.env.EMAIL_USER );
  
  
  const mailOptions = {
    from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Email Verification",
    html: `
      <h2>Verify your email address</h2>
      <p>Click the link below to verify your email:</p>
      <a href="${verifyLink}">Verify Email</a>
    `,
  };

  try {
    await sendEmailViaAPI(mailOptions);
  } catch (error) {
    console.error("Send verification email error:", error.message);
    throw new Error("Failed to send verification email");
  }
};

const sendPasswordResetEmail = async (email, resetToken) => {
  const mailOptions = {
    from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Reset Your Password - ' + process.env.COMPANY_NAME,
    html: `
      <h1>Reset Your Password</h1>
      <p>Please click the link below to reset your password:</p>
      <a href="${process.env.BASE_URL}forgot-password-reset?token=${resetToken}">
        Reset Password
      </a>
      <p>This link will expire in 10 min.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `
  };

  try {
    await sendEmailViaAPI(mailOptions);
  } catch (error) {
    console.error('Send password reset email error:', error);
    throw new Error('Failed to send password reset email');
  }
};
module.exports = {
  sendVerificationEmail,  
  sendPasswordResetEmail
};