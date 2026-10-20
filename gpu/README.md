# GPU Systems

GPU 아키텍처와 CUDA 프로그래밍부터 Kubernetes GPU 플랫폼 운영까지 다루는 문서 모음입니다.
강좌는 실행 원리를 익히는 데, 참고자료는 세부 동작을 확인하는 데, 실습과 기술 아티클은 성능 분석과 운영 판단에 활용할 수 있습니다.

| 찾고 있는 내용 | 바로가기 |
| --- | --- |
| GPU 공유·격리·플랫폼 운영 | [기술 아티클](#기술-아티클) |
| 병렬 컴퓨팅과 CUDA 학습 | [강좌와 강의 노트](#강좌와-강의-노트) |
| 아키텍처와 CUDA 동작 확인 | [참고자료](#참고자료) |
| 프로파일링과 커널 구현 | [실습](#실습) |
| 처음 시작할 때의 학습 순서 | [추천 학습 순서](#추천-학습-순서) |

## 기술 아티클

GPU 자원 공유와 격리, 장애 분석, 반복 가능한 플랫폼 운영을 다룹니다. [아티클 모아보기](articles/README.md)

- [GPU 인프라 운영과 플랫폼 설계: 하드웨어 장애 분석부터 멀티테넌시까지](articles/gpu-infrastructure-operations-and-platform-design.ko.md)
- [DRA와 HAMi로 보는 Kubernetes GPU 분할](articles/hami-dra-gpu-sharing.ko.md)
- [HAMi-core Deep Dive: `libvgpu.so`는 GPU를 어떻게 나누는가](articles/hami-core-deep-dive.ko.md)

## 강좌와 강의 노트

### CS149 · 병렬 컴퓨팅

CPU 병렬성, SIMD, 스케줄링, 메모리와 GPU 실행을 연결하는 시스템 기초 강좌입니다. [강좌 안내](cs149/README.md)

1. [Why Parallelism? Why Efficiency?](cs149/lec01/README.md)
2. [A Modern Multi-Core Processor](cs149/lec02/README.md)
3. [Multi-Core Architecture, Part II and ISPC](cs149/lec03/README.md)
4. [Parallel Programming Basics](cs149/lec04/README.md)
5. [Performance Optimization I — Work Distribution and Scheduling](cs149/lec05/README.md)
6. [Performance Optimization II — Locality, Communication, and Contention](cs149/lec06/README.md)
7. [GPU Architecture and CUDA Programming](cs149/lec07/README.md)
8. [Data-Parallel Thinking](cs149/lec08/README.md)
9. [Distributed Data-Parallel Computing Using Spark](cs149/lec09/README.md)
10. [Efficiently Evaluating DNNs on GPUs](cs149/lec10/README.md)

### PMPP · CUDA 프로그래밍

*Programming Massively Parallel Processors*를 바탕으로 CUDA 실행 모델과 메모리 구조를 익힙니다. 현재 정리된 강의 노트는 다음과 같습니다. [강좌 안내](pmpp/README.md)

- [Lecture 2 — Data Parallel Programming and the CUDA Programming Model](pmpp/lec02/README.md)
- [Lecture 3 — Multidimensional Grids and Data](pmpp/lec03/README.md)
- [Lecture 4 — GPU Architecture](pmpp/lec04/README.md)
- [Lecture 5 — Memory Architecture and Tiling](pmpp/lec05/README.md)

### 함께 볼 강좌

- [Heterogeneous Systems — Onur Mutlu](heterogeneous-systems/README.md): 병렬 패턴과 이기종 시스템을 다른 관점에서 복습합니다.
- [GPU MODE](gpu-mode/README.md): 현대 ML 커널과 GPU 최적화를 심화 학습합니다.

## 참고자료

- [GPU Architecture](appendix/architecture/README.md): NVIDIA GPU 아키텍처와 하드웨어 동작.
- [CUDA](appendix/cuda/README.md): CUDA 실행·메모리 모델과 API 참고자료.

## 실습

- [Profiling](labs/profiling/README.md): Nsight 도구로 병목과 성능 변화를 확인하는 실습.
- [Kernel Case Studies](labs/kernels/README.md): 커널을 구현하고 실행 특성을 비교하는 사례.

## 추천 학습 순서

1. **CUDA 기초:** [PMPP](pmpp/README.md)를 중심으로 실행 모델과 메모리 구조를 익힙니다.
2. **시스템 기초:** [CS149](cs149/README.md)로 병렬성, 스케줄링, locality, 동기화와 DNN 실행을 연결합니다.
3. **반복 실습:** 개념을 배울 때마다 [커널을 구현](labs/kernels/README.md)하고 [프로파일링](labs/profiling/README.md)으로 동작을 확인합니다.
4. **복습과 참고:** [Heterogeneous Systems](heterogeneous-systems/README.md)로 병렬 패턴을 복습하고, [아키텍처](appendix/architecture/README.md)와 [CUDA 참고자료](appendix/cuda/README.md)에서 세부 사항을 확인합니다.
5. **심화와 운영:** [GPU MODE](gpu-mode/README.md)로 최적화를 확장하고, [기술 아티클](articles/README.md)로 공유·격리·플랫폼 운영 문제를 살펴봅니다.
