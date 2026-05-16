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
    <img src="${process.env.COMPANY_LOGO}" alt="Logo" style="width: 200px; height: 30px;"/>
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
     <img src="${process.env.COMPANY_LOGO}" alt="Logo" style="width: 200px; height: 30px;"/>
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

const sendContactEmail = async ({ name, email, description }) => {
  const mailOptions = {
    from: `"${process.env.COMPANY_NAME}" <${process.env.EMAIL_USER}>`,
    to: process.env.CONTACT_RECEIVER_EMAIL, // the mail where you want to receive contact form messages
    subject: `New Contact Form Message from ${name}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <img src="${process.env.COMPANY_LOGO}" alt="Logo" style="width: 200px; height: 30px; margin-bottom: 16px;" />
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <div style="padding: 12px; background: #f7f7f7; border-radius: 8px; white-space: pre-line;">
          ${description}
        </div>
      </div>
    `,
  };

  try {
    await sendEmailViaAPI(mailOptions);
  } catch (error) {
    console.error("Send contact email error:", error.message);
    throw new Error("Failed to send contact email");
  }
};
module.exports = {
  sendVerificationEmail,  
  sendPasswordResetEmail,
  sendContactEmail
};