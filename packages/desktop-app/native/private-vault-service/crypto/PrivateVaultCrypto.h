#ifndef AGENT_NATIVE_PRIVATE_VAULT_CRYPTO_H
#define AGENT_NATIVE_PRIVATE_VAULT_CRYPTO_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
  ANC_PV_HASH_BYTES = 32,
  ANC_PV_SEED_BYTES = 32,
  ANC_PV_SIGN_PUBLIC_KEY_BYTES = 32,
  ANC_PV_SIGN_PRIVATE_KEY_BYTES = 64,
  ANC_PV_SIGNATURE_BYTES = 64,
  ANC_PV_BOX_PUBLIC_KEY_BYTES = 32,
  ANC_PV_BOX_PRIVATE_KEY_BYTES = 32,
  ANC_PV_NONCE_BYTES = 24,
  ANC_PV_KEY_BYTES = 32,
  ANC_PV_AUTH_BYTES = 16,
  ANC_PV_PWHASH_SALT_BYTES = 16,
  ANC_PV_SECRETSTREAM_HEADER_BYTES = 24,
  ANC_PV_SECRETSTREAM_AUTH_BYTES = 17,
  ANC_PV_ARGON2ID_OPS_LIMIT = 2,
  ANC_PV_ARGON2ID_MEMORY_LIMIT = 67108864,
  ANC_PV_MAX_MESSAGE_BYTES = 16 * 1024 * 1024,
  ANC_PV_MAX_AAD_BYTES = 1024 * 1024,
  ANC_PV_MAX_PASSPHRASE_BYTES = 1024,
  ANC_PV_MAX_RANDOM_BYTES = 1024 * 1024,
};

typedef enum AncPrivateVaultCryptoStatus {
  ANC_PV_CRYPTO_OK = 0,
  ANC_PV_CRYPTO_INVALID_ARGUMENT = 1,
  ANC_PV_CRYPTO_AUTHENTICATION_FAILED = 2,
  ANC_PV_CRYPTO_OPERATION_FAILED = 3,
} AncPrivateVaultCryptoStatus;

/*
 * Box wrap/open, AEAD, and secretstream output ranges must be disjoint from
 * every input range and from each other.
 */

AncPrivateVaultCryptoStatus anc_pv_crypto_init(void);

AncPrivateVaultCryptoStatus
anc_pv_blake2b_256(uint8_t output[ANC_PV_HASH_BYTES], const uint8_t *message,
                   size_t message_length);

AncPrivateVaultCryptoStatus
anc_pv_blake2b_256_keyed(uint8_t output[ANC_PV_HASH_BYTES],
                         const uint8_t *message, size_t message_length,
                         const uint8_t key[ANC_PV_KEY_BYTES]);

AncPrivateVaultCryptoStatus
anc_pv_ed25519_seed_keypair(uint8_t public_key[ANC_PV_SIGN_PUBLIC_KEY_BYTES],
                            uint8_t private_key[ANC_PV_SIGN_PRIVATE_KEY_BYTES],
                            const uint8_t seed[ANC_PV_SEED_BYTES]);

AncPrivateVaultCryptoStatus
anc_pv_ed25519_sign(uint8_t signature[ANC_PV_SIGNATURE_BYTES],
                    const uint8_t *message, size_t message_length,
                    const uint8_t private_key[ANC_PV_SIGN_PRIVATE_KEY_BYTES]);

AncPrivateVaultCryptoStatus
anc_pv_ed25519_verify(const uint8_t signature[ANC_PV_SIGNATURE_BYTES],
                      const uint8_t *message, size_t message_length,
                      const uint8_t public_key[ANC_PV_SIGN_PUBLIC_KEY_BYTES]);

AncPrivateVaultCryptoStatus
anc_pv_box_seed_keypair(uint8_t public_key[ANC_PV_BOX_PUBLIC_KEY_BYTES],
                        uint8_t private_key[ANC_PV_BOX_PRIVATE_KEY_BYTES],
                        const uint8_t seed[ANC_PV_SEED_BYTES]);

AncPrivateVaultCryptoStatus
anc_pv_box_wrap(uint8_t *ciphertext, size_t ciphertext_capacity,
                size_t *ciphertext_length, const uint8_t *plaintext,
                size_t plaintext_length,
                const uint8_t nonce[ANC_PV_NONCE_BYTES],
                const uint8_t recipient_public_key[ANC_PV_BOX_PUBLIC_KEY_BYTES],
                const uint8_t sender_private_key[ANC_PV_BOX_PRIVATE_KEY_BYTES]);

AncPrivateVaultCryptoStatus anc_pv_box_open(
    uint8_t *plaintext, size_t plaintext_capacity, size_t *plaintext_length,
    const uint8_t *ciphertext, size_t ciphertext_length,
    const uint8_t nonce[ANC_PV_NONCE_BYTES],
    const uint8_t sender_public_key[ANC_PV_BOX_PUBLIC_KEY_BYTES],
    const uint8_t recipient_private_key[ANC_PV_BOX_PRIVATE_KEY_BYTES]);

AncPrivateVaultCryptoStatus anc_pv_xchacha20poly1305_encrypt(
    uint8_t *ciphertext, size_t ciphertext_capacity, size_t *ciphertext_length,
    const uint8_t *plaintext, size_t plaintext_length,
    const uint8_t *associated_data, size_t associated_data_length,
    const uint8_t nonce[ANC_PV_NONCE_BYTES],
    const uint8_t key[ANC_PV_KEY_BYTES]);

AncPrivateVaultCryptoStatus anc_pv_xchacha20poly1305_decrypt(
    uint8_t *plaintext, size_t plaintext_capacity, size_t *plaintext_length,
    const uint8_t *ciphertext, size_t ciphertext_length,
    const uint8_t *associated_data, size_t associated_data_length,
    const uint8_t nonce[ANC_PV_NONCE_BYTES],
    const uint8_t key[ANC_PV_KEY_BYTES]);

AncPrivateVaultCryptoStatus
anc_pv_argon2id(uint8_t output[ANC_PV_KEY_BYTES], const uint8_t *passphrase,
                size_t passphrase_length,
                const uint8_t salt[ANC_PV_PWHASH_SALT_BYTES]);

AncPrivateVaultCryptoStatus anc_pv_secretstream_encrypt_final(
    uint8_t header[ANC_PV_SECRETSTREAM_HEADER_BYTES], uint8_t *ciphertext,
    size_t ciphertext_capacity, size_t *ciphertext_length,
    const uint8_t *plaintext, size_t plaintext_length,
    const uint8_t *associated_data, size_t associated_data_length,
    const uint8_t key[ANC_PV_KEY_BYTES]);

AncPrivateVaultCryptoStatus anc_pv_secretstream_decrypt_final(
    uint8_t *plaintext, size_t plaintext_capacity, size_t *plaintext_length,
    const uint8_t header[ANC_PV_SECRETSTREAM_HEADER_BYTES],
    const uint8_t *ciphertext, size_t ciphertext_length,
    const uint8_t *associated_data, size_t associated_data_length,
    const uint8_t key[ANC_PV_KEY_BYTES]);

AncPrivateVaultCryptoStatus anc_pv_random(uint8_t *output, size_t length);
AncPrivateVaultCryptoStatus anc_pv_memcmp(const uint8_t *left,
                                          const uint8_t *right, size_t length);
void anc_pv_zeroize(void *value, size_t length);

#ifdef __cplusplus
}
#endif

#endif
