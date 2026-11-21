# Articles

AI 데이터센터 시스템을 다루는 기술 아티클입니다. 분야별 학습 노트가 개념을 체계적으로 쌓아 가는 문서라면, 아티클은 운영 사례, 장애 분석, 설계 판단을 한 편씩 완결된 글로 다룹니다.

새 글은 [RSS 피드](https://adcs.restack.tech/articles/rss.xml)로 받아 볼 수 있습니다.

## 전체 글

<!-- articles:start (generated from article frontmatter by `npm run articles:index` in .site; do not edit by hand) -->

### [같은 SM에서 반복되는 GPU 오류는 하드웨어 불량의 증거일까?](gpu-sm-warp-memory-and-cudnn-rtx5090.ko.md)

2026-11-01 · GPU

RTX 5090 학습 장애를 따라가며 SM·warp 실행 구조, GPU 메모리 계층, cuDNN의 커널 선택과 Nsight로 실패 지점을 좁히는 방법을 살펴본다.

### [rm -rf 사고로 손상된 DGX B200 노드 복구기](dgx-b200-rm-rf-recovery.ko.md)

2026-10-28 · GPU · [English](dgx-b200-rm-rf-recovery.md)

rm -rf 실수로 시스템 파일이 지워진 DGX B200 노드를 DGX OS 복구 환경과 chroot로 되살린 과정을 돌아본다.

### [GPU 인프라 운영과 플랫폼 설계: 하드웨어 장애 분석부터 멀티테넌시까지](gpu-infrastructure-operations-and-platform-design.ko.md)

2026-10-21 · GPU

하드웨어 장애 진단부터 노드 등록·검증, 멀티테넌트 운영까지 GPU 플랫폼을 반복 가능하게 운영하는 방법을 정리한다.

### [HAMi-core 심층 분석: `libvgpu.so`는 GPU를 어떻게 나누는가](hami-core-deep-dive.ko.md)

2026-07-07 · GPU

HAMi-core의 libvgpu.so가 CUDA·NVML 호출에 개입해 컨테이너가 보는 GPU 메모리와 연산 자원을 나누는 방식을 따라간다.

### [DRA와 HAMi로 보는 Kubernetes GPU 분할](hami-dra-gpu-sharing.ko.md)

2026-07-07 · GPU

Kubernetes DRA가 맡는 GPU 할당과, HAMi가 맡는 GPU 안의 메모리·연산 제한을 나눠서 비교한다.

### [Cloud Data Center Network의 지금과 앞으로](cloud-data-center-network-now-and-next.ko.md)

2026-06-28 · Network

web-scale 클라우드 네트워크에서 AI/ML용 backend fabric으로 넘어가는 흐름을 compute와 storage 구조의 변화에서 짚는다.

### [Keeping GPU Workloads NUMA-Local in Kubernetes](keeping-gpu-workloads-numa-local-in-kubernetes.ko.md)

2026-06-28 · Systems Performance, GPU

kubelet 정책, topology-aware scheduling, workload sizing으로 Kubernetes에서 GPU workload의 NUMA locality를 지키는 방법을 다룬다.

### [Never Underestimate Memory Architecture](never-underestimate-memory-architecture.ko.md)

2026-06-28 · Systems Performance

Grafana Cloud 사례를 바탕으로 NUMA와 shared uncore 자원이 대형 서버와 cloud VM의 성능을 어떻게 좌우하는지 정리한다.

<!-- articles:end -->
