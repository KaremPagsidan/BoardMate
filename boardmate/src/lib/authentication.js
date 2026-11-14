import { supabase } from '../supabaseClient';

export function normalizePhoneNumber(phone) {
  const value = phone.trim();
  const digits = value.replace(/\D/g, '');
  let normalizedDigits = digits;
  if (!value.startsWith('+')) {
    if (digits.startsWith('00')) normalizedDigits = digits.slice(2);
    else if (digits.startsWith('0')) normalizedDigits = `63${digits.slice(1)}`;
    else if (!digits.startsWith('63')) {
      throw new Error('Enter the phone number with a + country code, or use a Philippine number starting with 0.');
    }
  }
  if (!/^[1-9]\d{6,14}$/.test(normalizedDigits)) {
    throw new Error('Enter a valid phone number, including its country code.');
  }
  return `+${normalizedDigits}`;
}

export async function signInWithEmail(address, password) {
  const email = address.trim();
  if (!email.includes('@')) {
    throw new Error('Enter a valid email address.');
  }
  return supabase.auth.signInWithPassword({ email, password });
}
