# AI Systems Performance Engineering

- [Chapter 1: Introduction and AI System Overview](./chap01/README.md)
- [Chapter 2: AI System Hardware Overview](./chap02/README.md)
- [Chapter 3: OS, Docker, and Kubernetes Tuning for GPU-Based Environments](./chap03/README.md)
- [Chapter 4: Tuning Distributed Networking Communication](./chap04/README.md)
- [Chapter 5: GPU-Based Storage I/O Optimizations](./chap05/README.md)
- [Chapter 6: GPU Architecture, CUDA Programming, and Maximizing Occupancy](./chap06/README.md)

## 블로그

GPU 시스템의 성능 문제를 운영 관점에서 다룬 글입니다. [블로그 전체 글](../blog/README.md)

<!-- blog:start (generated from post frontmatter by `npm run blog:index` in .site; do not edit by hand) -->

- [Keeping GPU Workloads NUMA-Local in Kubernetes](../blog/2026-06-28-keeping-gpu-workloads-numa-local-in-kubernetes.ko.md)
- [Never Underestimate Memory Architecture](../blog/2026-06-28-never-underestimate-memory-architecture.ko.md)

<!-- blog:end -->

## Resources

### Books

- [AI Systems Performance Engineering: Optimizing Model Training and Inference Workloads with GPUs, CUDA, and PyTorch](https://www.amazon.com/Systems-Performance-Engineering-Optimizing-Inference/dp/B0F47689K8) (2025.12)
  - [Code](https://github.com/cfregly/ai-performance-engineering)

### Articles

- [Making Deep Learning Go Brrrr From First Principles](https://horace.io/brrr_intro.html)
- [Hardware Architectures for LLM Inference](../inference/efficient-llm-inference-systems/appendix/hardware-architectures/README.md)

### Talks

- [The Engineering Behind Training a 2 Trillion Parameter LLM](https://www.youtube.com/watch?v=yn4GGAtZ7QE) (2026.04)
- [Never Underestimate Memory Architecture - Bryan Boreham, Grafana Labs](https://www.youtube.com/watch?v=C6aBa1vnYT4)

### GPU

- [H100 Tensor Core GPU Architecture](https://resources.nvidia.com/en-us-hopper-architecture/nvidia-h100-tensor-c)
- [NVIDIA Blackwell Architecture Technical Brief](https://resources.nvidia.com/en-us-blackwell-architecture)
- [NVFP4 Trains with Precision of 16-Bit and Speed and Efficiency of 4-Bit](https://developer.nvidia.com/blog/nvfp4-trains-with-precision-of-16-bit-and-speed-and-efficiency-of-4-bit/?ncid=no-ncid) (2025.08)
- [Using FP8 and FP4 with Transformer Engine](https://docs.nvidia.com/deeplearning/transformer-engine/user-guide/examples/fp8_primer.html)
- [NCCL and Communication Collectives](https://roycho96.github.io/posts/nccl-collectives/)
- [NCCL Algorithms](https://roycho96.github.io/posts/nccl-algorithms/)
