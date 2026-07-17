#include "PrivateVaultCrypto.h"

#include <sodium.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition)                                                       \
  do {                                                                         \
    if (!(condition)) {                                                        \
      fprintf(stderr, "Private Vault crypto vector failed at line %d\n",       \
              __LINE__);                                                       \
      return 1;                                                                \
    }                                                                          \
  } while (0)

static void fill(uint8_t *output, size_t length, uint8_t byte) {
  memset(output, byte, length);
}

static int from_hex(uint8_t *output, size_t output_length, const char *hex) {
  if (strlen(hex) != output_length * 2)
    return 0;
  for (size_t index = 0; index < output_length; index++) {
    unsigned int value = 0;
    if (sscanf(hex + index * 2, "%2x", &value) != 1)
      return 0;
    output[index] = (uint8_t)value;
  }
  return 1;
}

static int equal_hex(const uint8_t *value, size_t length, const char *hex) {
  uint8_t *expected = malloc(length == 0 ? 1 : length);
  if (expected == NULL || !from_hex(expected, length, hex)) {
    free(expected);
    return 0;
  }
  const int equal = anc_pv_memcmp(value, expected, length) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(expected, length);
  free(expected);
  return equal;
}

static int test_fixed_core_vectors(void) {
  static const uint8_t payload[] = "synthetic native parity payload";
  static const uint8_t aad[] = "anc/v1/job\0synthetic parity aad";
  static const uint8_t hash_message[] =
      "anc/v1/manifest\0synthetic native parity payload";
  static const uint8_t box_message[] =
      "anc/v1/eek-wrap\0synthetic native parity payload";
  uint8_t seed[ANC_PV_SEED_BYTES];
  uint8_t public_key[ANC_PV_SIGN_PUBLIC_KEY_BYTES];
  uint8_t private_key[ANC_PV_SIGN_PRIVATE_KEY_BYTES];
  uint8_t hash[ANC_PV_HASH_BYTES];
  uint8_t signature[ANC_PV_SIGNATURE_BYTES];
  uint8_t key[ANC_PV_KEY_BYTES];
  uint8_t nonce[ANC_PV_NONCE_BYTES];
  uint8_t ciphertext[256];
  uint8_t plaintext[256];
  size_t ciphertext_length = 0;
  size_t plaintext_length = 0;

  fill(seed, sizeof seed, 0x11);
  CHECK(anc_pv_ed25519_seed_keypair(public_key, private_key, seed) ==
        ANC_PV_CRYPTO_OK);
  CHECK(equal_hex(
      public_key, sizeof public_key,
      "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737"));
  CHECK(equal_hex(
      private_key, sizeof private_key,
      "1111111111111111111111111111111111111111111111111111111111111111"
      "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737"));
  CHECK(anc_pv_blake2b_256(hash, hash_message, sizeof hash_message - 1) ==
        ANC_PV_CRYPTO_OK);
  CHECK(equal_hex(
      hash, sizeof hash,
      "05d9eaa8c60242e5f03cbc45b173911221113d0e5d5620113cc3910dffceef44"));
  fill(key, sizeof key, 0x22);
  CHECK(anc_pv_blake2b_256_keyed(hash, hash_message, sizeof hash_message - 1,
                                 key) == ANC_PV_CRYPTO_OK);
  uint8_t keyed_expected[ANC_PV_HASH_BYTES] = {0};
  CHECK(crypto_generichash_blake2b(keyed_expected, sizeof keyed_expected,
                                   hash_message, sizeof hash_message - 1, key,
                                   sizeof key) == 0);
  CHECK(anc_pv_memcmp(hash, keyed_expected, sizeof hash) == ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(keyed_expected, sizeof keyed_expected);
  CHECK(anc_pv_ed25519_sign(signature, hash_message, sizeof hash_message - 1,
                            private_key) == ANC_PV_CRYPTO_OK);
  CHECK(equal_hex(
      signature, sizeof signature,
      "aa177c87cef4d73d2b8228c22a6174cba94260165e78590d9947f5ef21c6877c"
      "da43fb496c403622c042eb0ad1e131a063bace37c16eb2ca5089efb9ccfa2305"));
  CHECK(anc_pv_ed25519_verify(signature, hash_message, sizeof hash_message - 1,
                              public_key) == ANC_PV_CRYPTO_OK);
  signature[0] ^= 1;
  CHECK(anc_pv_ed25519_verify(signature, hash_message, sizeof hash_message - 1,
                              public_key) ==
        ANC_PV_CRYPTO_AUTHENTICATION_FAILED);

  fill(key, sizeof key, 0x22);
  fill(nonce, sizeof nonce, 0x33);
  CHECK(anc_pv_xchacha20poly1305_encrypt(
            ciphertext, sizeof ciphertext, &ciphertext_length, payload,
            sizeof payload - 1, aad, sizeof aad - 1, nonce,
            key) == ANC_PV_CRYPTO_OK);
  CHECK(equal_hex(
      ciphertext, ciphertext_length,
      "e1834a19ada111efc33867ca2a8fdd420d10607b348a27917cb0976b01e1fa23"
      "b221ec1209ff2508d0e0658e4b93d9"));
  CHECK(anc_pv_xchacha20poly1305_decrypt(plaintext, sizeof plaintext,
                                         &plaintext_length, ciphertext,
                                         ciphertext_length, aad, sizeof aad - 1,
                                         nonce, key) == ANC_PV_CRYPTO_OK);
  CHECK(plaintext_length == sizeof payload - 1);
  CHECK(memcmp(plaintext, payload, plaintext_length) == 0);
  ciphertext[0] ^= 1;
  memset(plaintext, 0xa5, sizeof plaintext);
  CHECK(anc_pv_xchacha20poly1305_decrypt(
            plaintext, sizeof plaintext, &plaintext_length, ciphertext,
            ciphertext_length, aad, sizeof aad - 1, nonce,
            key) == ANC_PV_CRYPTO_AUTHENTICATION_FAILED);
  CHECK(plaintext_length == 0);
  for (size_t index = 0; index < sizeof payload - 1; index++)
    CHECK(plaintext[index] == 0);
  ciphertext[0] ^= 1;

  uint8_t sender_public[ANC_PV_BOX_PUBLIC_KEY_BYTES];
  uint8_t sender_private[ANC_PV_BOX_PRIVATE_KEY_BYTES];
  uint8_t recipient_public[ANC_PV_BOX_PUBLIC_KEY_BYTES];
  uint8_t recipient_private[ANC_PV_BOX_PRIVATE_KEY_BYTES];
  fill(seed, sizeof seed, 0x44);
  CHECK(anc_pv_box_seed_keypair(sender_public, sender_private, seed) ==
        ANC_PV_CRYPTO_OK);
  fill(seed, sizeof seed, 0x55);
  CHECK(anc_pv_box_seed_keypair(recipient_public, recipient_private, seed) ==
        ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_box_wrap(ciphertext, sizeof ciphertext, &ciphertext_length,
                        box_message, sizeof box_message - 1, nonce,
                        recipient_public, sender_private) == ANC_PV_CRYPTO_OK);
  CHECK(equal_hex(
      ciphertext, ciphertext_length,
      "04cb5679226c0ecd0226f7061beccc7f234ed8c6f634f01856ea771ef783de90"
      "86547122c712cb25e7b545aeaac0136a3b121ec23da1f757978a3d3faf70c3"));
  CHECK(anc_pv_box_open(plaintext, sizeof plaintext, &plaintext_length,
                        ciphertext, ciphertext_length, nonce, sender_public,
                        recipient_private) == ANC_PV_CRYPTO_OK);
  CHECK(plaintext_length == sizeof box_message - 1);
  CHECK(memcmp(plaintext, box_message, plaintext_length) == 0);
  ciphertext[0] ^= 1;
  memset(plaintext, 0xa5, sizeof plaintext);
  CHECK(anc_pv_box_open(plaintext, sizeof plaintext, &plaintext_length,
                        ciphertext, ciphertext_length, nonce, sender_public,
                        recipient_private) ==
        ANC_PV_CRYPTO_AUTHENTICATION_FAILED);
  CHECK(plaintext_length == 0);
  for (size_t index = 0; index < sizeof box_message - 1; index++)
    CHECK(plaintext[index] == 0);

  uint8_t salt[ANC_PV_PWHASH_SALT_BYTES];
  static const uint8_t passphrase[] = "synthetic recovery parity phrase";
  fill(salt, sizeof salt, 0x66);
  CHECK(anc_pv_argon2id(key, passphrase, sizeof passphrase - 1, salt) ==
        ANC_PV_CRYPTO_OK);
  CHECK(equal_hex(
      key, sizeof key,
      "b404bf5aa0ce57f3506e52e9a722a22c59adb1e0fb774eea451d2a94f2a824ad"));

  anc_pv_zeroize(seed, sizeof seed);
  anc_pv_zeroize(private_key, sizeof private_key);
  anc_pv_zeroize(sender_private, sizeof sender_private);
  anc_pv_zeroize(recipient_private, sizeof recipient_private);
  anc_pv_zeroize(key, sizeof key);
  return 0;
}

static int test_secretstream_and_zeroize(void) {
  static const uint8_t expected_plaintext[] = "synthetic chunk bytes";
  uint8_t header[ANC_PV_SECRETSTREAM_HEADER_BYTES];
  uint8_t ciphertext[128];
  uint8_t plaintext[128];
  uint8_t key[ANC_PV_KEY_BYTES];
  uint8_t aad[] = {0x61, 0x6e, 0x63, 0x2f, 0x76, 0x31, 0x2f, 0x63, 0x68,
                   0x75, 0x6e, 0x6b, 0x00, 0xa4, 0x18, 0x32, 0x50, 0x04,
                   0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04,
                   0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x18, 0x33, 0x03,
                   0x18, 0x84, 0x00, 0x18, 0x85, 0x01};
  size_t plaintext_length = 0;
  CHECK(from_hex(header, sizeof header,
                 "3f5fda67e8463e269d11c141f228d3921570da36f06db90d"));
  const char *ciphertext_hex =
      "03f8b067a34acb2883703117670be1a0e10b6255798ce738db867e8aff6732b0"
      "21a168c3470c";
  const size_t ciphertext_length = strlen(ciphertext_hex) / 2;
  const size_t pinned_plaintext_length =
      ciphertext_length - ANC_PV_SECRETSTREAM_AUTH_BYTES;
  CHECK(from_hex(ciphertext, ciphertext_length, ciphertext_hex));
  fill(key, sizeof key, 0x66);
  CHECK(anc_pv_secretstream_decrypt_final(
            plaintext, sizeof plaintext, &plaintext_length, header, ciphertext,
            ciphertext_length, aad, sizeof aad, key) == ANC_PV_CRYPTO_OK);
  CHECK(plaintext_length == sizeof expected_plaintext - 1);
  CHECK(memcmp(plaintext, expected_plaintext, plaintext_length) == 0);

  ciphertext[ciphertext_length - 1] ^= 1;
  memset(plaintext, 0xa5, sizeof plaintext);
  CHECK(anc_pv_secretstream_decrypt_final(
            plaintext, sizeof plaintext, &plaintext_length, header, ciphertext,
            ciphertext_length, aad, sizeof aad,
            key) == ANC_PV_CRYPTO_AUTHENTICATION_FAILED);
  CHECK(plaintext_length == 0);
  for (size_t index = 0; index < pinned_plaintext_length; index++)
    CHECK(plaintext[index] == 0);

  size_t new_ciphertext_length = 0;
  CHECK(anc_pv_secretstream_encrypt_final(
            header, ciphertext, sizeof ciphertext, &new_ciphertext_length,
            expected_plaintext, sizeof expected_plaintext - 1, aad, sizeof aad,
            key) == ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_secretstream_decrypt_final(
            plaintext, sizeof plaintext, &plaintext_length, header, ciphertext,
            new_ciphertext_length, aad, sizeof aad, key) == ANC_PV_CRYPTO_OK);

  crypto_secretstream_xchacha20poly1305_state raw_state;
  unsigned long long raw_length = 0;
  CHECK(crypto_secretstream_xchacha20poly1305_init_push(&raw_state, header,
                                                        key) == 0);
  CHECK(crypto_secretstream_xchacha20poly1305_push(
            &raw_state, ciphertext, &raw_length, expected_plaintext,
            sizeof expected_plaintext - 1, aad, sizeof aad,
            crypto_secretstream_xchacha20poly1305_TAG_MESSAGE) == 0);
  CHECK(anc_pv_secretstream_decrypt_final(
            plaintext, sizeof plaintext, &plaintext_length, header, ciphertext,
            (size_t)raw_length, aad, sizeof aad,
            key) == ANC_PV_CRYPTO_AUTHENTICATION_FAILED);
  CHECK(plaintext_length == 0);
  anc_pv_zeroize(&raw_state, sizeof raw_state);

  CHECK(anc_pv_secretstream_encrypt_final(
            header, ciphertext, sizeof ciphertext, &new_ciphertext_length,
            expected_plaintext, sizeof expected_plaintext - 1, aad, sizeof aad,
            key) == ANC_PV_CRYPTO_OK);
  ciphertext[new_ciphertext_length - 1] ^= 1;
  CHECK(anc_pv_secretstream_decrypt_final(
            plaintext, sizeof plaintext, &plaintext_length, header, ciphertext,
            new_ciphertext_length, aad, sizeof aad,
            key) == ANC_PV_CRYPTO_AUTHENTICATION_FAILED);

  fill(key, sizeof key, 0xa5);
  anc_pv_zeroize(key, sizeof key);
  for (size_t index = 0; index < sizeof key; index++)
    CHECK(key[index] == 0);
  CHECK(anc_pv_memcmp(NULL, key, sizeof key) == ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(anc_pv_random(key, sizeof key) == ANC_PV_CRYPTO_OK);
  uint8_t random2[ANC_PV_KEY_BYTES];
  CHECK(anc_pv_random(random2, sizeof random2) == ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_memcmp(key, random2, sizeof key) ==
        ANC_PV_CRYPTO_AUTHENTICATION_FAILED);
  anc_pv_zeroize(key, sizeof key);
  anc_pv_zeroize(random2, sizeof random2);
  return 0;
}

static int test_bounds(void) {
  uint8_t output[64];
  uint8_t one = 1;
  size_t length = 99;
  CHECK(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
  CHECK(strcmp(sodium_version_string(), "1.0.21") == 0);
  CHECK(anc_pv_blake2b_256(output, NULL, 1) == ANC_PV_CRYPTO_INVALID_ARGUMENT);
  uint8_t hash_key[ANC_PV_KEY_BYTES] = {0};
  CHECK(anc_pv_blake2b_256_keyed(output, NULL, 1, hash_key) ==
        ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(anc_pv_blake2b_256_keyed(output, output, 1, hash_key) ==
        ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(anc_pv_blake2b_256_keyed(output, &one, 1, output) ==
        ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(anc_pv_random(output, 0) == ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(anc_pv_argon2id(output, NULL, 0, output) ==
        ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(anc_pv_xchacha20poly1305_encrypt(
            output, sizeof output, &length, &one, ANC_PV_MAX_MESSAGE_BYTES + 1,
            NULL, 0, output, output) == ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(length == 0);
  uint8_t nonce[ANC_PV_NONCE_BYTES] = {0};
  uint8_t key[ANC_PV_KEY_BYTES] = {0};
  length = 99;
  CHECK(anc_pv_xchacha20poly1305_encrypt(output, 1, &length, &one, 1, NULL, 0,
                                         nonce, key) ==
        ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(length == 0);
  length = 99;
  CHECK(anc_pv_xchacha20poly1305_encrypt(output, sizeof output, &length, output,
                                         1, NULL, 0, nonce, key) ==
        ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(length == 0);
  length = 99;
  CHECK(anc_pv_xchacha20poly1305_encrypt(output, sizeof output, &length, &one,
                                         1, output + 8, 1, nonce, key) ==
        ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(length == 0);
  CHECK(anc_pv_xchacha20poly1305_encrypt(output, sizeof output, NULL, &one, 1,
                                         NULL, 0, nonce, key) ==
        ANC_PV_CRYPTO_INVALID_ARGUMENT);
  uint8_t box_public[ANC_PV_BOX_PUBLIC_KEY_BYTES] = {0};
  uint8_t box_private[ANC_PV_BOX_PRIVATE_KEY_BYTES] = {0};
  length = 99;
  CHECK(anc_pv_box_wrap(output, 1, &length, &one, 1, nonce, box_public,
                        box_private) == ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(length == 0);
  uint8_t header[ANC_PV_SECRETSTREAM_HEADER_BYTES] = {0};
  length = 99;
  CHECK(anc_pv_secretstream_encrypt_final(header, output, 1, &length, &one, 1,
                                          NULL, 0, key) ==
        ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(length == 0);
  length = 99;
  CHECK(anc_pv_secretstream_encrypt_final(output, output, sizeof output,
                                          &length, &one, 1, NULL, 0, key) ==
        ANC_PV_CRYPTO_INVALID_ARGUMENT);
  CHECK(length == 0);
  return 0;
}

int main(void) {
  if (test_bounds() != 0 || test_fixed_core_vectors() != 0 ||
      test_secretstream_and_zeroize() != 0) {
    return 1;
  }
  puts("Private Vault native crypto vectors passed");
  return 0;
}
