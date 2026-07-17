#include "RequestGate.h"

#include <assert.h>
#include <stdio.h>

#include <atomic>
#include <chrono>
#include <thread>
#include <vector>

int main() {
  PVRequestGate gate;
  assert(gate.tryAcquire());

  std::atomic<int> rejected{0};
  std::vector<std::thread> contenders;
  const auto start = std::chrono::steady_clock::now();
  for (int index = 0; index < 128; index += 1) {
    contenders.emplace_back([&]() {
      if (!gate.tryAcquire())
        rejected.fetch_add(1, std::memory_order_relaxed);
    });
  }
  for (auto &contender : contenders)
    contender.join();
  const auto elapsed = std::chrono::steady_clock::now() - start;

  assert(rejected.load(std::memory_order_relaxed) == 128);
  assert(elapsed < std::chrono::seconds(1));

  gate.release();
  assert(gate.tryAcquire());
  assert(!gate.tryAcquire());
  gate.release();

  puts("private-vault-xpc-client request gate tests passed");
  return 0;
}
