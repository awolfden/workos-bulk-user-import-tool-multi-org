/**
 * Firebase Scrypt to PHC Format Encoder
 *
 * Encodes Firebase's modified scrypt password hash parameters into
 * PHC (Password Hashing Competition) string format that WorkOS accepts
 * with password_hash_type: 'firebase-scrypt'.
 *
 * PHC format:
 *   $firebase-scrypt$hash=<b64hash>$salt=<b64salt>$sk=<b64signerKey>$ss=<b64saltSep>$r=<rounds>$m=<memCost>
 *
 * Reference: https://workos.com/docs/migrate/firebase
 */

/** Project-level scrypt parameters from Firebase Console */
export interface FirebaseScryptParams {
  signerKey: string;       // base64_signer_key
  saltSeparator: string;   // base64_salt_separator
  rounds: number;          // typically 8
  memCost: number;         // typically 14
}

/** Per-user password data from Firebase export */
export interface UserPasswordData {
  passwordHash: string;    // base64-encoded per-user hash
  salt: string;            // base64-encoded per-user salt
}

/**
 * Normalize URL-safe base64 to standard base64.
 * Firebase CLI sometimes emits URL-safe base64 (using - and _ instead of + and /).
 */
function normalizeBase64(value: string): string {
  return value.replace(/-/g, '+').replace(/_/g, '/');
}

/**
 * Encode Firebase scrypt password into PHC format string.
 *
 * @param userData Per-user password hash and salt
 * @param params Project-level scrypt parameters
 * @returns PHC format string ready for WorkOS import
 */
export function encodeFirebaseScryptPHC(
  userData: UserPasswordData,
  params: FirebaseScryptParams
): string {
  const hash = normalizeBase64(userData.passwordHash);
  const salt = normalizeBase64(userData.salt);
  const sk = normalizeBase64(params.signerKey);
  const ss = normalizeBase64(params.saltSeparator);

  return `$firebase-scrypt$hash=${hash}$salt=${salt}$sk=${sk}$ss=${ss}$r=${params.rounds}$m=${params.memCost}`;
}
