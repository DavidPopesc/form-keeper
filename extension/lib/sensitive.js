// Heuristics for fields that should never be stored, even when the page didn't
// mark them as password/credit-card inputs.

const SENSITIVE_NAME =
  /\b(pass(word|wd|code|phrase)?|pwd|pw|otp|2fa|mfa|totp|cvv2?|cvc|csc|card ?(num(ber)?|no)|cc ?(num(ber)?|no|exp)|security ?code|ssn|social ?security|pin|secret|token|csrf|xsrf|authenticity|captcha|recaptcha|nonce|viewstate|eventvalidation|api ?key)\b/;

// "creditCardNumber" / "card_number" / "cc-num" -> "credit card number" etc.
function words(text) {
  return String(text || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.[\]:]+/g, " ")
    .toLowerCase();
}

function looksLikeCardNumber(value) {
  const digits = String(value).replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  // Luhn checksum.
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function isSensitiveField({ name, label, value }) {
  return SENSITIVE_NAME.test(words(name)) || SENSITIVE_NAME.test(words(label)) || looksLikeCardNumber(value);
}
