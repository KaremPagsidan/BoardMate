export const minimumPasswordLength = 6;

export function registrationPasswordError(password) {
  if (!password || !password.trim()) return 'Please enter a password.';
  if (password.length < minimumPasswordLength) return 'Password must be at least 6 characters.';
  return '';
}

export function registrationBirthDateError(value, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'Please enter a valid date of birth.';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'Please enter a valid date of birth.';
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return value > today ? 'Date of birth cannot be in the future.' : '';
}
