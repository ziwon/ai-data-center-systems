# Inference

LLM 추론의 성능 지표와 하드웨어부터 커널 최적화, 모델 구조, 서비스 운영까지 다루는 문서 모음입니다.
주차별 강의로 기초를 익히고, 하드웨어 참고자료와 실습 결과를 통해 실제 병목과 최적화 효과를 확인할 수 있습니다.

| 찾고 있는 내용 | 바로가기 |
| --- | --- |
| 성능 지표·KV cache·양자화·speculative decoding | [추론 시스템 강좌](#추론-시스템-강좌) |
| Attention 커널과 서비스 운영 | [커널 최적화와 서빙](#커널-최적화와-서빙) |
| Transformer와 추론 실행의 기초 | [기초 참고자료](#기초-참고자료) |
| Roofline과 GPU·TPU·NPU 비교 | [하드웨어 아키텍처](#하드웨어-아키텍처) |
| 모델별 구조와 서빙 특성 | [모델 아키텍처](#모델-아키텍처) |

## 추론 시스템 강좌

*Efficient LLM Inference Systems*는 추론의 성능과 비용을 측정하고 개선하는 과정을 주차별로 다룹니다. [강좌 안내](efficient-llm-inference-systems/README.md)

1. [Week 1 — Understanding Performance Metrics](efficient-llm-inference-systems/week01/README.md): TTFT, TPOT, 처리량과 메모리 한계를 측정합니다.
2. [Week 2 — Hardware Foundations for Inference](efficient-llm-inference-systems/week02/README.md): 메모리 계층, Tensor Core, roofline과 GPU 간 통신을 다룹니다.
3. [Week 3 — Transformer Inference and the KV Cache](efficient-llm-inference-systems/week03/README.md): Attention 구조와 장문 컨텍스트의 메모리 비용을 분석합니다.
4. [Week 4 — Quantization](efficient-llm-inference-systems/week04/README.md): 양자화 방식, 커널 지원과 품질·성능의 관계를 비교합니다.
5. [Week 5 — Speculative Decoding](efficient-llm-inference-systems/week05/README.md): draft 전략과 acceptance rate에 따른 지연 시간 개선 조건을 살펴봅니다.

실측 결과는 [Week 4 양자화 실습 결과](efficient-llm-inference-systems/week04/results/RESULTS.md)에 정리되어 있습니다. 같은 비트 수에서도 커널과 실행 엔진에 따라 달라지는 성능을 비교합니다.

## 커널 최적화와 서빙

- **FlashAttention:** online softmax와 tiling의 원리부터 세대별 최적화까지 다룹니다. [한국어](flashattention-from-first-principles/README.ko.md) · [English](flashattention-from-first-principles/README.md)
- **[SGLang in 2026: Engineering a Production-Grade LLM Serving Stack](sglang-production-practices/README.md)** — RadixAttention, Model Gateway, HiCache, prefill-decode 분리와 운영 배포를 다루는 영문 문서입니다.

## 기초 참고자료

여러 주차에서 공통으로 사용하는 배경 지식입니다. [참고자료 모아보기](efficient-llm-inference-systems/appendix/README.md)

- [LLM Inference](efficient-llm-inference-systems/appendix/llm-inference/README.md)
- [Transformer](efficient-llm-inference-systems/appendix/transformer/README.md)

## 하드웨어 아키텍처

연산량, 데이터 이동, 메모리 용량과 통신을 기준으로 추론 하드웨어를 살펴봅니다. [읽기 안내와 강좌 연결](efficient-llm-inference-systems/appendix/hardware-architectures/README.md)

1. [All About Rooflines](efficient-llm-inference-systems/appendix/hardware-architectures/roofline.ko.md)
2. [Domain-Specific Architectures for AI Inference](efficient-llm-inference-systems/appendix/hardware-architectures/domain-specific-architectures-for-ai-inference.ko.md)
3. [How to Think About TPUs](efficient-llm-inference-systems/appendix/hardware-architectures/tpus.ko.md)
4. [How to Think About GPUs](efficient-llm-inference-systems/appendix/hardware-architectures/gpus.ko.md)
5. [How to Think About NPUs](efficient-llm-inference-systems/appendix/hardware-architectures/npus.ko.md)

## 모델 아키텍처

모델 설계가 메모리, 통신, 캐시와 병렬화에 미치는 영향을 정리합니다. [모델 문서 모아보기](models/README.md)

- [How We Scaled Kimi K2.5: 토큰 효율, 장문 컨텍스트, 에이전트 스웜](models/kimi-k2-5-scaling.md)
- [Kimi K3 기술 해부: 2.8T MoE, KDA, Attention Residuals, 그리고 64-GPU 서빙](models/kimi-k3.md)

## 추천 학습 순서

1. **기초:** 추론 시스템 강좌에서 지표·하드웨어·KV cache를 먼저 익힙니다.
2. **커널:** FlashAttention으로 중간 행렬을 HBM에 저장하지 않는 원리와 GPU 세대별 최적화의 차이를 살펴봅니다.
3. **운영:** SGLang에서 SLO를 만족하며 처리한 요청량인 goodput을 기준으로 서빙 시스템을 검토합니다.
4. **모델별 확인:** 대상 모델의 메모리·통신 특성을 확인하고, 하드웨어 참고자료와 실측 결과를 함께 읽습니다.

## 더 읽을 자료

- [Inference Engineering](https://www.baseten.co/inference-engineering/) — 모델 아키텍처, GPU 하드웨어, inference engine, 최적화 기법, production serving을 아우르는 실무 안내서
- **Hands-On LLM Serving and Optimization** (Chi Wang, Peiheng Hu) — KV cache, batching, quantization, speculative decoding, 분산 serving과 vLLM 최적화를 실습 중심으로 다룹니다.
  - [Book](https://orca3.github.io/llm-model-inference/) · [Video](https://www.oreilly.com/library/view/hands-on-llm-serving/9798341621480/) · [Code and Notebooks](https://github.com/orca3/llm-model-inference)
