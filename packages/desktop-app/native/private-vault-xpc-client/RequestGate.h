#ifndef AGENT_NATIVE_PRIVATE_VAULT_XPC_CLIENT_REQUEST_GATE_H
#define AGENT_NATIVE_PRIVATE_VAULT_XPC_CLIENT_REQUEST_GATE_H

#include <atomic>

class PVRequestGate {
public:
  bool tryAcquire() {
    bool expected = false;
    return occupied_.compare_exchange_strong(
        expected, true, std::memory_order_acq_rel, std::memory_order_relaxed);
  }

  void release() { occupied_.store(false, std::memory_order_release); }

private:
  std::atomic<bool> occupied_{false};
};

#endif
