#include "PrivateVaultCrypto.h"

#include <sodium.h>

#include <limits.h>

_Static_assert(ANC_PV_HASH_BYTES == crypto_generichash_blake2b_BYTES,
               "anc/v1 hash size drift");
_Static_assert(ANC_PV_SIGN_PUBLIC_KEY_BYTES == crypto_sign_PUBLICKEYBYTES,
               "anc/v1 signing public-key size drift");
_Static_assert(ANC_PV_SIGN_PRIVATE_KEY_BYTES == crypto_sign_SECRETKEYBYTES,
               "anc/v1 signing private-key size drift");
_Static_assert(ANC_PV_SIGNATURE_BYTES == crypto_sign_BYTES,
               "anc/v1 signature size drift");
_Static_assert(ANC_PV_BOX_PUBLIC_KEY_BYTES == crypto_box_PUBLICKEYBYTES,
               "anc/v1 box public-key size drift");
_Static_assert(ANC_PV_BOX_PRIVATE_KEY_BYTES == crypto_box_SECRETKEYBYTES,
               "anc/v1 box private-key size drift");
_Static_assert(ANC_PV_NONCE_BYTES == crypto_box_NONCEBYTES,
               "anc/v1 nonce size drift");
_Static_assert(ANC_PV_NONCE_BYTES ==
                   crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
               "anc/v1 AEAD nonce size drift");
_Static_assert(ANC_PV_AUTH_BYTES == crypto_box_MACBYTES,
               "anc/v1 box authentication size drift");
_Static_assert(ANC_PV_AUTH_BYTES == crypto_aead_xchacha20poly1305_ietf_ABYTES,
               "anc/v1 AEAD authentication size drift");

static int anc_pv_valid_bytes(const uint8_t *value, size_t length,
                              size_t maximum) {
  return length <= maximum && (length == 0 || value != NULL);
}

static int anc_pv_valid_output(uint8_t *value, size_t capacity,
                               size_t required) {
  return required <= capacity && (required == 0 || value != NULL);
}

static int anc_pv_ranges_overlap(const void *left, size_t left_length,
                                 const void *right, size_t right_length) {
  if (left_length == 0 || right_length == 0)
    return 0;
  if (left == NULL || right == NULL)
    return 1;
  const uintptr_t left_start = (uintptr_t)left;
  const uintptr_t right_start = (uintptr_t)right;
  if (left_start > UINTPTR_MAX - left_length ||
      right_start > UINTPTR_MAX - right_length) {
    return 1;
  }
  return left_start < right_start + right_length &&
         right_start < left_start + left_length;
}

AncPrivateVaultCryptoStatus anc_pv_crypto_init(void) {
  return sodium_init() >= 0 ? ANC_PV_CRYPTO_OK : ANC_PV_CRYPTO_OPERATION_FAILED;
}

AncPrivateVaultCryptoStatus
anc_pv_blake2b_256(uint8_t output[ANC_PV_HASH_BYTES], const uint8_t *message,
                   size_t message_length) {
  if (output == NULL ||
      !anc_pv_valid_bytes(message, message_length, ANC_PV_MAX_MESSAGE_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  return crypto_generichash_blake2b(output, ANC_PV_HASH_BYTES, message,
                                    (unsigned long long)message_length, NULL,
                                    0) == 0
             ? ANC_PV_CRYPTO_OK
             : ANC_PV_CRYPTO_OPERATION_FAILED;
}

AncPrivateVaultCryptoStatus anc_pv_blake2b_256_two_part(
    uint8_t output[ANC_PV_HASH_BYTES], const uint8_t *first,
    size_t first_length, const uint8_t *second, size_t second_length) {
  if (output == NULL ||
      !anc_pv_valid_bytes(first, first_length, ANC_PV_MAX_MESSAGE_BYTES) ||
      !anc_pv_valid_bytes(second, second_length, ANC_PV_MAX_MESSAGE_BYTES) ||
      first_length > ANC_PV_MAX_MESSAGE_BYTES - second_length ||
      anc_pv_ranges_overlap(output, ANC_PV_HASH_BYTES, first, first_length) ||
      anc_pv_ranges_overlap(output, ANC_PV_HASH_BYTES, second, second_length)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  crypto_generichash_blake2b_state state;
  int result = crypto_generichash_blake2b_init(&state, NULL, 0,
                                               ANC_PV_HASH_BYTES);
  if (result == 0 && first_length > 0) {
    result = crypto_generichash_blake2b_update(
        &state, first, (unsigned long long)first_length);
  }
  if (result == 0 && second_length > 0) {
    result = crypto_generichash_blake2b_update(
        &state, second, (unsigned long long)second_length);
  }
  if (result == 0)
    result = crypto_generichash_blake2b_final(&state, output,
                                              ANC_PV_HASH_BYTES);
  sodium_memzero(&state, sizeof state);
  if (result != 0) {
    sodium_memzero(output, ANC_PV_HASH_BYTES);
    return ANC_PV_CRYPTO_OPERATION_FAILED;
  }
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus
anc_pv_blake2b_256_keyed(uint8_t output[ANC_PV_HASH_BYTES],
                         const uint8_t *message, size_t message_length,
                         const uint8_t key[ANC_PV_KEY_BYTES]) {
  if (output == NULL || key == NULL ||
      !anc_pv_valid_bytes(message, message_length, ANC_PV_MAX_MESSAGE_BYTES) ||
      anc_pv_ranges_overlap(output, ANC_PV_HASH_BYTES, message,
                            message_length) ||
      anc_pv_ranges_overlap(output, ANC_PV_HASH_BYTES, key, ANC_PV_KEY_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  if (crypto_generichash_blake2b(output, ANC_PV_HASH_BYTES, message,
                                 (unsigned long long)message_length, key,
                                 ANC_PV_KEY_BYTES) != 0) {
    anc_pv_zeroize(output, ANC_PV_HASH_BYTES);
    return ANC_PV_CRYPTO_OPERATION_FAILED;
  }
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus
anc_pv_ed25519_seed_keypair(uint8_t public_key[ANC_PV_SIGN_PUBLIC_KEY_BYTES],
                            uint8_t private_key[ANC_PV_SIGN_PRIVATE_KEY_BYTES],
                            const uint8_t seed[ANC_PV_SEED_BYTES]) {
  if (public_key == NULL || private_key == NULL || seed == NULL) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  return crypto_sign_seed_keypair(public_key, private_key, seed) == 0
             ? ANC_PV_CRYPTO_OK
             : ANC_PV_CRYPTO_OPERATION_FAILED;
}

AncPrivateVaultCryptoStatus
anc_pv_ed25519_sign(uint8_t signature[ANC_PV_SIGNATURE_BYTES],
                    const uint8_t *message, size_t message_length,
                    const uint8_t private_key[ANC_PV_SIGN_PRIVATE_KEY_BYTES]) {
  unsigned long long signature_length = 0;
  if (signature == NULL || private_key == NULL ||
      !anc_pv_valid_bytes(message, message_length, ANC_PV_MAX_MESSAGE_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  if (crypto_sign_detached(signature, &signature_length, message,
                           (unsigned long long)message_length,
                           private_key) != 0 ||
      signature_length != ANC_PV_SIGNATURE_BYTES) {
    sodium_memzero(signature, ANC_PV_SIGNATURE_BYTES);
    return ANC_PV_CRYPTO_OPERATION_FAILED;
  }
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus
anc_pv_ed25519_verify(const uint8_t signature[ANC_PV_SIGNATURE_BYTES],
                      const uint8_t *message, size_t message_length,
                      const uint8_t public_key[ANC_PV_SIGN_PUBLIC_KEY_BYTES]) {
  if (signature == NULL || public_key == NULL ||
      !anc_pv_valid_bytes(message, message_length, ANC_PV_MAX_MESSAGE_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  return crypto_sign_verify_detached(signature, message,
                                     (unsigned long long)message_length,
                                     public_key) == 0
             ? ANC_PV_CRYPTO_OK
             : ANC_PV_CRYPTO_AUTHENTICATION_FAILED;
}

AncPrivateVaultCryptoStatus
anc_pv_box_seed_keypair(uint8_t public_key[ANC_PV_BOX_PUBLIC_KEY_BYTES],
                        uint8_t private_key[ANC_PV_BOX_PRIVATE_KEY_BYTES],
                        const uint8_t seed[ANC_PV_SEED_BYTES]) {
  if (public_key == NULL || private_key == NULL || seed == NULL) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  return crypto_box_seed_keypair(public_key, private_key, seed) == 0
             ? ANC_PV_CRYPTO_OK
             : ANC_PV_CRYPTO_OPERATION_FAILED;
}

AncPrivateVaultCryptoStatus anc_pv_box_wrap(
    uint8_t *ciphertext, size_t ciphertext_capacity, size_t *ciphertext_length,
    const uint8_t *plaintext, size_t plaintext_length,
    const uint8_t nonce[ANC_PV_NONCE_BYTES],
    const uint8_t recipient_public_key[ANC_PV_BOX_PUBLIC_KEY_BYTES],
    const uint8_t sender_private_key[ANC_PV_BOX_PRIVATE_KEY_BYTES]) {
  const size_t required = plaintext_length + ANC_PV_AUTH_BYTES;
  if (ciphertext_length != NULL)
    *ciphertext_length = 0;
  if (ciphertext_length == NULL || nonce == NULL ||
      recipient_public_key == NULL || sender_private_key == NULL ||
      !anc_pv_valid_bytes(plaintext, plaintext_length,
                          ANC_PV_MAX_MESSAGE_BYTES) ||
      plaintext_length > SIZE_MAX - ANC_PV_AUTH_BYTES ||
      !anc_pv_valid_output(ciphertext, ciphertext_capacity, required) ||
      anc_pv_ranges_overlap(ciphertext, required, plaintext,
                            plaintext_length) ||
      anc_pv_ranges_overlap(ciphertext, required, nonce, ANC_PV_NONCE_BYTES) ||
      anc_pv_ranges_overlap(ciphertext, required, recipient_public_key,
                            ANC_PV_BOX_PUBLIC_KEY_BYTES) ||
      anc_pv_ranges_overlap(ciphertext, required, sender_private_key,
                            ANC_PV_BOX_PRIVATE_KEY_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  if (crypto_box_easy(ciphertext, plaintext,
                      (unsigned long long)plaintext_length, nonce,
                      recipient_public_key, sender_private_key) != 0) {
    sodium_memzero(ciphertext, required);
    return ANC_PV_CRYPTO_OPERATION_FAILED;
  }
  *ciphertext_length = required;
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus anc_pv_box_open(
    uint8_t *plaintext, size_t plaintext_capacity, size_t *plaintext_length,
    const uint8_t *ciphertext, size_t ciphertext_length,
    const uint8_t nonce[ANC_PV_NONCE_BYTES],
    const uint8_t sender_public_key[ANC_PV_BOX_PUBLIC_KEY_BYTES],
    const uint8_t recipient_private_key[ANC_PV_BOX_PRIVATE_KEY_BYTES]) {
  const size_t required = ciphertext_length >= ANC_PV_AUTH_BYTES
                              ? ciphertext_length - ANC_PV_AUTH_BYTES
                              : 0;
  if (plaintext_length != NULL)
    *plaintext_length = 0;
  if (plaintext_length == NULL || nonce == NULL || sender_public_key == NULL ||
      recipient_private_key == NULL || ciphertext_length < ANC_PV_AUTH_BYTES ||
      !anc_pv_valid_bytes(ciphertext, ciphertext_length,
                          ANC_PV_MAX_MESSAGE_BYTES + ANC_PV_AUTH_BYTES) ||
      !anc_pv_valid_output(plaintext, plaintext_capacity, required) ||
      anc_pv_ranges_overlap(plaintext, required, ciphertext,
                            ciphertext_length) ||
      anc_pv_ranges_overlap(plaintext, required, nonce, ANC_PV_NONCE_BYTES) ||
      anc_pv_ranges_overlap(plaintext, required, sender_public_key,
                            ANC_PV_BOX_PUBLIC_KEY_BYTES) ||
      anc_pv_ranges_overlap(plaintext, required, recipient_private_key,
                            ANC_PV_BOX_PRIVATE_KEY_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  if (crypto_box_open_easy(plaintext, ciphertext,
                           (unsigned long long)ciphertext_length, nonce,
                           sender_public_key, recipient_private_key) != 0) {
    sodium_memzero(plaintext, required);
    return ANC_PV_CRYPTO_AUTHENTICATION_FAILED;
  }
  *plaintext_length = required;
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus anc_pv_xchacha20poly1305_encrypt(
    uint8_t *ciphertext, size_t ciphertext_capacity, size_t *ciphertext_length,
    const uint8_t *plaintext, size_t plaintext_length,
    const uint8_t *associated_data, size_t associated_data_length,
    const uint8_t nonce[ANC_PV_NONCE_BYTES],
    const uint8_t key[ANC_PV_KEY_BYTES]) {
  unsigned long long produced = 0;
  const size_t required = plaintext_length + ANC_PV_AUTH_BYTES;
  if (ciphertext_length != NULL)
    *ciphertext_length = 0;
  if (ciphertext_length == NULL || nonce == NULL || key == NULL ||
      !anc_pv_valid_bytes(plaintext, plaintext_length,
                          ANC_PV_MAX_MESSAGE_BYTES) ||
      !anc_pv_valid_bytes(associated_data, associated_data_length,
                          ANC_PV_MAX_AAD_BYTES) ||
      plaintext_length > SIZE_MAX - ANC_PV_AUTH_BYTES ||
      !anc_pv_valid_output(ciphertext, ciphertext_capacity, required) ||
      anc_pv_ranges_overlap(ciphertext, required, plaintext,
                            plaintext_length) ||
      anc_pv_ranges_overlap(ciphertext, required, associated_data,
                            associated_data_length) ||
      anc_pv_ranges_overlap(ciphertext, required, nonce, ANC_PV_NONCE_BYTES) ||
      anc_pv_ranges_overlap(ciphertext, required, key, ANC_PV_KEY_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  if (crypto_aead_xchacha20poly1305_ietf_encrypt(
          ciphertext, &produced, plaintext,
          (unsigned long long)plaintext_length, associated_data,
          (unsigned long long)associated_data_length, NULL, nonce, key) != 0 ||
      produced != required) {
    sodium_memzero(ciphertext, required);
    return ANC_PV_CRYPTO_OPERATION_FAILED;
  }
  *ciphertext_length = required;
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus anc_pv_xchacha20poly1305_decrypt(
    uint8_t *plaintext, size_t plaintext_capacity, size_t *plaintext_length,
    const uint8_t *ciphertext, size_t ciphertext_length,
    const uint8_t *associated_data, size_t associated_data_length,
    const uint8_t nonce[ANC_PV_NONCE_BYTES],
    const uint8_t key[ANC_PV_KEY_BYTES]) {
  unsigned long long produced = 0;
  const size_t required = ciphertext_length >= ANC_PV_AUTH_BYTES
                              ? ciphertext_length - ANC_PV_AUTH_BYTES
                              : 0;
  if (plaintext_length != NULL)
    *plaintext_length = 0;
  if (plaintext_length == NULL || nonce == NULL || key == NULL ||
      ciphertext_length < ANC_PV_AUTH_BYTES ||
      !anc_pv_valid_bytes(ciphertext, ciphertext_length,
                          ANC_PV_MAX_MESSAGE_BYTES + ANC_PV_AUTH_BYTES) ||
      !anc_pv_valid_bytes(associated_data, associated_data_length,
                          ANC_PV_MAX_AAD_BYTES) ||
      !anc_pv_valid_output(plaintext, plaintext_capacity, required) ||
      anc_pv_ranges_overlap(plaintext, required, ciphertext,
                            ciphertext_length) ||
      anc_pv_ranges_overlap(plaintext, required, associated_data,
                            associated_data_length) ||
      anc_pv_ranges_overlap(plaintext, required, nonce, ANC_PV_NONCE_BYTES) ||
      anc_pv_ranges_overlap(plaintext, required, key, ANC_PV_KEY_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  if (crypto_aead_xchacha20poly1305_ietf_decrypt(
          plaintext, &produced, NULL, ciphertext,
          (unsigned long long)ciphertext_length, associated_data,
          (unsigned long long)associated_data_length, nonce, key) != 0 ||
      produced != required) {
    sodium_memzero(plaintext, required);
    return ANC_PV_CRYPTO_AUTHENTICATION_FAILED;
  }
  *plaintext_length = required;
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus
anc_pv_argon2id(uint8_t output[ANC_PV_KEY_BYTES], const uint8_t *passphrase,
                size_t passphrase_length,
                const uint8_t salt[ANC_PV_PWHASH_SALT_BYTES]) {
  if (output == NULL || salt == NULL || passphrase_length == 0 ||
      !anc_pv_valid_bytes(passphrase, passphrase_length,
                          ANC_PV_MAX_PASSPHRASE_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  if (crypto_pwhash(output, ANC_PV_KEY_BYTES, (const char *)passphrase,
                    (unsigned long long)passphrase_length, salt,
                    ANC_PV_ARGON2ID_OPS_LIMIT, ANC_PV_ARGON2ID_MEMORY_LIMIT,
                    crypto_pwhash_ALG_ARGON2ID13) != 0) {
    sodium_memzero(output, ANC_PV_KEY_BYTES);
    return ANC_PV_CRYPTO_OPERATION_FAILED;
  }
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus anc_pv_secretstream_encrypt_final(
    uint8_t header[ANC_PV_SECRETSTREAM_HEADER_BYTES], uint8_t *ciphertext,
    size_t ciphertext_capacity, size_t *ciphertext_length,
    const uint8_t *plaintext, size_t plaintext_length,
    const uint8_t *associated_data, size_t associated_data_length,
    const uint8_t key[ANC_PV_KEY_BYTES]) {
  crypto_secretstream_xchacha20poly1305_state state;
  unsigned long long produced = 0;
  const size_t required = plaintext_length + ANC_PV_SECRETSTREAM_AUTH_BYTES;
  if (ciphertext_length != NULL)
    *ciphertext_length = 0;
  if (header == NULL || ciphertext_length == NULL || key == NULL ||
      !anc_pv_valid_bytes(plaintext, plaintext_length,
                          ANC_PV_MAX_MESSAGE_BYTES) ||
      !anc_pv_valid_bytes(associated_data, associated_data_length,
                          ANC_PV_MAX_AAD_BYTES) ||
      plaintext_length > SIZE_MAX - ANC_PV_SECRETSTREAM_AUTH_BYTES ||
      !anc_pv_valid_output(ciphertext, ciphertext_capacity, required) ||
      anc_pv_ranges_overlap(ciphertext, required, plaintext,
                            plaintext_length) ||
      anc_pv_ranges_overlap(ciphertext, required, associated_data,
                            associated_data_length) ||
      anc_pv_ranges_overlap(ciphertext, required, header,
                            ANC_PV_SECRETSTREAM_HEADER_BYTES) ||
      anc_pv_ranges_overlap(ciphertext, required, key, ANC_PV_KEY_BYTES) ||
      anc_pv_ranges_overlap(header, ANC_PV_SECRETSTREAM_HEADER_BYTES, plaintext,
                            plaintext_length) ||
      anc_pv_ranges_overlap(header, ANC_PV_SECRETSTREAM_HEADER_BYTES,
                            associated_data, associated_data_length) ||
      anc_pv_ranges_overlap(header, ANC_PV_SECRETSTREAM_HEADER_BYTES, key,
                            ANC_PV_KEY_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  if (crypto_secretstream_xchacha20poly1305_init_push(&state, header, key) !=
          0 ||
      crypto_secretstream_xchacha20poly1305_push(
          &state, ciphertext, &produced, plaintext,
          (unsigned long long)plaintext_length, associated_data,
          (unsigned long long)associated_data_length,
          crypto_secretstream_xchacha20poly1305_TAG_FINAL) != 0 ||
      produced != required) {
    sodium_memzero(&state, sizeof state);
    sodium_memzero(header, ANC_PV_SECRETSTREAM_HEADER_BYTES);
    sodium_memzero(ciphertext, required);
    return ANC_PV_CRYPTO_OPERATION_FAILED;
  }
  sodium_memzero(&state, sizeof state);
  *ciphertext_length = required;
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus anc_pv_secretstream_decrypt_final(
    uint8_t *plaintext, size_t plaintext_capacity, size_t *plaintext_length,
    const uint8_t header[ANC_PV_SECRETSTREAM_HEADER_BYTES],
    const uint8_t *ciphertext, size_t ciphertext_length,
    const uint8_t *associated_data, size_t associated_data_length,
    const uint8_t key[ANC_PV_KEY_BYTES]) {
  crypto_secretstream_xchacha20poly1305_state state;
  unsigned long long produced = 0;
  unsigned char tag = 0;
  const size_t required =
      ciphertext_length >= ANC_PV_SECRETSTREAM_AUTH_BYTES
          ? ciphertext_length - ANC_PV_SECRETSTREAM_AUTH_BYTES
          : 0;
  if (plaintext_length != NULL)
    *plaintext_length = 0;
  if (plaintext_length == NULL || header == NULL || key == NULL ||
      ciphertext_length < ANC_PV_SECRETSTREAM_AUTH_BYTES ||
      !anc_pv_valid_bytes(ciphertext, ciphertext_length,
                          ANC_PV_MAX_MESSAGE_BYTES +
                              ANC_PV_SECRETSTREAM_AUTH_BYTES) ||
      !anc_pv_valid_bytes(associated_data, associated_data_length,
                          ANC_PV_MAX_AAD_BYTES) ||
      !anc_pv_valid_output(plaintext, plaintext_capacity, required) ||
      anc_pv_ranges_overlap(plaintext, required, ciphertext,
                            ciphertext_length) ||
      anc_pv_ranges_overlap(plaintext, required, associated_data,
                            associated_data_length) ||
      anc_pv_ranges_overlap(plaintext, required, header,
                            ANC_PV_SECRETSTREAM_HEADER_BYTES) ||
      anc_pv_ranges_overlap(plaintext, required, key, ANC_PV_KEY_BYTES)) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  if (crypto_secretstream_xchacha20poly1305_init_pull(&state, header, key) !=
          0 ||
      crypto_secretstream_xchacha20poly1305_pull(
          &state, plaintext, &produced, &tag, ciphertext,
          (unsigned long long)ciphertext_length, associated_data,
          (unsigned long long)associated_data_length) != 0 ||
      produced != required ||
      tag != crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
    sodium_memzero(&state, sizeof state);
    sodium_memzero(plaintext, required);
    return ANC_PV_CRYPTO_AUTHENTICATION_FAILED;
  }
  sodium_memzero(&state, sizeof state);
  *plaintext_length = required;
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus anc_pv_random(uint8_t *output, size_t length) {
  if (output == NULL || length == 0 || length > ANC_PV_MAX_RANDOM_BYTES) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  randombytes_buf(output, length);
  return ANC_PV_CRYPTO_OK;
}

AncPrivateVaultCryptoStatus anc_pv_memcmp(const uint8_t *left,
                                          const uint8_t *right, size_t length) {
  if (left == NULL || right == NULL || length == 0 ||
      length > ANC_PV_MAX_MESSAGE_BYTES) {
    return ANC_PV_CRYPTO_INVALID_ARGUMENT;
  }
  return sodium_memcmp(left, right, length) == 0
             ? ANC_PV_CRYPTO_OK
             : ANC_PV_CRYPTO_AUTHENTICATION_FAILED;
}

void anc_pv_zeroize(void *value, size_t length) {
  if (value != NULL && length > 0) {
    sodium_memzero(value, length);
  }
}
