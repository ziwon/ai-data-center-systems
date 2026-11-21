---
topics: [gpu]
description: "RTX 5090 학습 장애를 따라가며 SM·warp 실행 구조, GPU 메모리 계층, cuDNN의 커널 선택, Nsight로 실패 지점을 좁히는 방법과 장비 교체 후 재검증까지 살펴본다."
---

# 같은 SM에서 반복되는 GPU 오류는 하드웨어 불량의 증거일까?

RTX 5090 학습 장애로 살펴본 GPU 실행 구조, 메모리 계층, cuDNN의 커널 선택

> **업데이트 (2026-11-21)**: TF32 조건의 후속 실험, 학습 코드 없이 실행 경로를 재구성한 재현 코드, 장비 교체 후 재검증 결과를 추가했다. 처음 카드를 교체한 경위도 보존된 기록에 맞게 바로잡았다.

GPU 오류 로그에 같은 SM 좌표가 계속 찍히면 하드웨어 불량부터 떠올리게 된다. 이 글은 RTX 5090에서 겪은 학습 장애를 따라가며, 그 직관이 어디까지 맞고 어디서부터 증거가 더 필요한지 살펴본다. 사건은 간단히 소개하고, 오류를 해석하는 데 필요한 GPU의 동작 원리를 더 자세히 다뤘다.

이 글에서 다루는 내용은 다음과 같다.

- 로그의 GPC·TPC·SM 좌표와 CUDA의 grid·block·warp는 어떻게 이어지는가
- register, shared, local, global memory는 어디에 있고 무엇이 다른가
- `channels_last` 같은 레이아웃 변경이 warp의 메모리 접근을 어떻게 바꾸는가
- cuDNN은 같은 합성곱에 어떤 커널을 고르며, 그 선택을 어떻게 관찰하는가
- SM 예외, MMU fault, Xid 109는 각각 무슨 뜻인가
- 실패한 실행의 trace를 Nsight로 어떻게 남기고, 어느 연산까지 좁힐 수 있는가
- NVTX 구간의 길이를 GPU 실행 시간으로 오해하지 않으려면 무엇을 봐야 하는가
- 학습 코드 없이 Python과 cuDNN Backend API로 같은 실행 경로를 어떻게 재구성하는가
- 장비 교체 전후를 같은 재현 코드로 비교하면 무엇을 알 수 있는가
- 비슷한 오류를 만났을 때 어떤 순서로 범위를 좁혀 갈 수 있는가

CUDA 실행 모델과 PyTorch 학습에 익숙한 독자를 대상으로 썼다.

## 목차

- [사건 요약: 교체한 카드에서 같은 SM 오류가 반복됐다](#사건-요약-교체한-카드에서-같은-sm-오류가-반복됐다)
- [SM과 warp, 로그의 좌표가 가리키는 것](#sm과-warp-로그의-좌표가-가리키는-것)
- [GPU 메모리 계층: 접근 범위와 저장 위치는 다르다](#gpu-메모리-계층-접근-범위와-저장-위치는-다르다)
- [같은 텐서, 다른 주소: channels-last와 메모리 coalescing](#같은-텐서-다른-주소-channels-last와-메모리-coalescing)
- [cuDNN은 같은 합성곱에 어떤 커널을 고르는가](#cudnn은-같은-합성곱에-어떤-커널을-고르는가)
- [오류 로그 읽기: SM 예외와 MMU fault](#오류-로그-읽기-sm-예외와-mmu-fault)
- [같은 SM에서 반복된다는 것은 얼마나 강한 증거인가](#같은-sm에서-반복된다는-것은-얼마나-강한-증거인가)
- [비동기 실행과 오류 이후의 GPU 상태](#비동기-실행과-오류-이후의-gpu-상태)
- [실패한 실행 추적하기: Nsight Systems로 좁힌 dW 경로](#실패한-실행-추적하기-nsight-systems로-좁힌-dw-경로)
- [TF32 후속 실험: 같은 cuDNN에서도 다른 조건은 실패했다](#tf32-후속-실험-같은-cudnn에서도-다른-조건은-실패했다)
- [NVTX 구간은 GPU 실행 시간이 아니다](#nvtx-구간은-gpu-실행-시간이-아니다)
- [학습 코드 없이 실행 경로 재구성하기](#학습-코드-없이-실행-경로-재구성하기)
- [장비 교체 후 같은 재현 코드로 다시 확인하기](#장비-교체-후-같은-재현-코드로-다시-확인하기)
- [교체와 업데이트의 시간 순서는 인과관계가 아니다](#교체와-업데이트의-시간-순서는-인과관계가-아니다)
- [이번 사례에서 확인한 것과 확인하지 못한 것](#이번-사례에서-확인한-것과-확인하지-못한-것)
- [비슷한 오류를 만났을 때 제안하는 접근](#비슷한-오류를-만났을-때-제안하는-접근)
- [맺으며](#맺으며)
- [참고 자료](#참고-자료)

## 사건 요약: 교체한 카드에서 같은 SM 오류가 반복됐다

RTX 5090 서버 한 대에서 PCIe 연결 오류(AER와 Xid 79)가 이어져 그래픽카드를 교체했다. 교체 무렵 BIOS와 OS 커널도 함께 업데이트됐다. 그런데 교체한 카드에서 `channels_last`와 BF16을 쓰는 합성곱 모델의 학습이 GPU 메모리 오류로 계속 실패했고, 그때마다 다음과 같은 로그가 남았다.

```text
Graphics SM Warp Exception on (GPC 2, TPC 6, SM 1):
Out Of Range Address

ENGINE GRAPHICS GPC2 GPCCLIENT_T1_13 faulted @ 0x0_00000000
FAULT_PDE ACCESS_TYPE_VIRT_READ
```

교체 후 보존된 로그의 SM Warp Exception 104행은 모두 `GPC 2, TPC 6, SM 1`을 가리켰다. 교체 전 기록에는 SM 예외가 없었으므로, 교체 전의 PCIe 문제와 교체 후의 주소 접근 오류가 같은 원인인지는 알 수 없다. 좌표가 이렇게 한곳에 몰리면 그 SM의 물리적 불량을 의심하게 되지만, 그렇게 결론짓기 전에 확인할 것이 많다.

먼저 소프트웨어 조건을 바꿔 봤다. 당시 환경은 드라이버 580.159.03-open, PyTorch 2.10.0+cu128, cuDNN 9.10.2.21이었다.

- `channels_last`를 끄면 짧은 재현 시험을 통과했다.
- PyTorch를 2.11과 2.14로 올리면서 cuDNN도 각각 9.19와 9.24로 바뀐 환경에서도 오류는 그대로 재현됐다.
- PyTorch와 드라이버는 그대로 두고 cuDNN만 9.27로 바꾸자 재현 시험을 통과했고, 실제 학습도 끝까지 마쳤다.
- 다시 cuDNN 9.10으로 돌아가자 같은 SM에서 오류가 났다.

여기까지만 보면 새 cuDNN이 버그를 고친 것 같다. 그러나 이후 조사에서 나온 결과는 그 해석과 맞지 않았다.

- 비교 서버에서 cuDNN만 바꾸자 같은 합성곱에 전혀 다른 커널이 선택됐고, 같은 선택은 9.26에서도 나타났다.
- 실패한 실행을 Nsight Systems로 추적하자 BF16 학습의 실패 범위는 한 1×1 합성곱의 가중치 gradient(dW) 계산 경로까지 좁혀졌다.
- FP32 텐서에 TF32를 허용한 별도 재현 조건에서는 cuDNN 9.27도 실패했다. 드라이버를 R615로 올리고 새로 부팅한 첫 실행에서도 마찬가지였다.
- 이후 장비를 교체하자 같은 TF32 재현 조건이 통과했고, 같은 커널이 끝까지 실행됐다.

결국 cuDNN 9.27은 특정 BF16 학습 조건에서만 오류를 피해 갔다. 장비를 교체한 뒤에는 통과했으니 교체한 장비 쪽에 원인이 있었을 가능성이 크다. 다만 드라이버도 함께 바뀌어 통제된 비교가 아니고, 어느 부품의 어떤 결함인지도 확정하지 못했다.

이 글에는 서로 다른 세 실험이 나온다. 섞어 읽지 않도록 먼저 정리해 둔다.

| 목적 | 연산 | 정밀도와 확인 범위 |
|---|---|---|
| 커널 선택과 자원 비교 | 모델의 한 1×1 합성곱을 떼어 낸 최소 연산. batch 4096과, 실제 학습과 같은 작은 batch | BF16. cuDNN 9.10과 9.26·9.27의 실행 계획, 자원, SASS 비교. 실패 순간을 잡은 시험은 아님 |
| 실제 모델의 실패 범위 추적 | 실제 모델 안의 다른 1×1 합성곱 | BF16. 9.10의 dW 경로가 유력한 실패 후보. 9.27에서는 완료 |
| 후속 재현과 장비 교체 후 재검증 | 첫 번째와 같은 최소 연산(batch 4096) | FP32 저장, TF32 허용. 9.27에서도 forward에서 실패, 장비 교체 후 통과 |

실제 모델에서 가져온 연산이라, 채널 수와 feature map 크기 같은 구체적인 shape은 이 글에 적지 않았다.

여기까지 판단하는 데 가장 필요했던 것은 로그를 해석하는 배경지식이었다. 아래에서 하나씩 살펴본다.

## SM과 warp, 로그의 좌표가 가리키는 것

로그의 `GPC 2, TPC 6, SM 1`은 하드웨어 계층을 따라 내려가는 좌표다. RTX Blackwell에서는 GPC(Graphics Processing Cluster) 안에 TPC(Texture Processing Cluster)가 있고, TPC마다 SM(Streaming Multiprocessor)이 두 개씩 들어 있다. GB202 칩 전체는 GPC 12개 × GPC당 TPC 8개 × TPC당 SM 2개로 SM이 192개이고, RTX 5090은 그 가운데 170개를 활성화한 제품이다. 백서의 칩 구성도에 그려진 SM을 모두 실제 장치의 활성 SM으로 세면 안 된다.

SM에는 연산기와 함께 메모리 자원도 들어 있다. RTX Blackwell 백서에 따르면 SM 하나에 CUDA 코어 128개, Tensor Core 4개, 256KB 레지스터 파일, 128KB L1·shared memory가 있다. RTX 5090의 L2 캐시는 GPU 전체가 공유하는 96MB이고, 장치 메모리는 32GB GDDR7이다. 128KB는 L1과 shared memory를 합친 용량이라, 프로그램이 전부를 shared memory로 쓸 수는 없다.[^blackwell]

SM 안은 다시 네 구획(processing block)으로 나뉜다. 구획마다 L0 명령어 캐시, warp scheduler와 dispatch unit, 레지스터 파일, FP32/INT32 연산 유닛, Tensor Core, load/store 유닛이 있다. Scheduler는 실행 준비가 된 warp의 다음 명령을 고르고, dispatch unit은 그 명령을 실행 유닛으로 보낸다. L1 data cache와 shared memory는 네 구획이 함께 쓰는 SM 수준의 자원이다.

구획이 넷이라고 warp가 네 개씩 실행되는 것은 아니다. SM 하나에는 여러 warp의 실행 상태가 함께 상주하고, scheduler는 그 가운데 준비된 warp를 골라 명령을 발행한다. 예를 들어 128-thread block은 warp 네 개로 나뉘지만, 이 warp들이 구획마다 하나씩 고정 배치되지는 않는다. 상주할 수 있는 block과 warp의 수는 레지스터와 shared memory 사용량, 장치의 한도에 따라 정해진다.[^resident-blocks]

![CUDA 실행 단위와 SM의 메모리 자원](assets/gpu-sm-warp-sm-memory.svg)

*그림 1. 위쪽은 실행 단위 사이의 관계를, 아래쪽은 명령이 실행될 때 쓰는 메모리 자원을 보여준다. 캐시 경로는 단순화해 그렸으며, 모든 접근이 L1을 거치지는 않는다.*

CUDA 프로그램이 다루는 계층은 이와 다르다. 개발자는 grid와 thread block을 구성하고 block 안에 thread를 배치한다. GPU는 각 block을 SM 하나에 할당하고, block 안의 thread를 32개씩 묶은 warp 단위로 실행한다.

Warp의 thread(lane)마다 레지스터와 실행 상태가 따로 있다. 그래서 warp를 "같은 값을 처리하는 하나의 거대한 thread"로 생각하면 주소 계산과 분기 동작을 잘못 이해하기 쉽다. 같은 load 명령을 실행하더라도 lane마다 쓰는 포인터와 인덱스는 다를 수 있다.

Volta 이후의 NVIDIA GPU는 Independent Thread Scheduling으로 thread별 실행 상태를 관리한다. 같은 warp에 속한다고 해서 메모리 접근 순서나 동기화가 자동으로 보장되지는 않는다. 다른 thread가 쓴 shared memory를 읽는 코드에는 여전히 올바른 동기화가 필요하다.[^simt]

이 구조에서 **로그의 SM 좌표는 잘못된 접근을 실행한 위치이고, 잘못된 주소가 만들어진 위치와는 다를 수 있다.** lane 하나만 잘못된 주소에 접근해도 warp 단위 예외가 보고될 수 있다. 또 앞선 커널이 잘못된 인덱스를 메모리에 써 두고 다음 커널이 그 인덱스로 메모리를 읽는다면, fault는 값을 소비한 커널이 돌던 SM에서 보고된다. 값을 만든 커널은 전혀 다른 SM에서 실행됐을 수 있다.

## GPU 메모리 계층: 접근 범위와 저장 위치는 다르다

GPU 메모리를 이해하려면 **누가 접근할 수 있는가**(논리적 범위)와 **실제로 어디에 저장되는가**(물리적 위치)를 함께 봐야 한다. 이 둘을 섞으면 오류 메시지를 잘못 읽기 쉽다.

| 구분 | 논리적 접근 범위 | 주요 물리적 저장 위치 | 주로 담는 것 |
|---|---|---|---|
| Register | thread 전용 | SM 내부 레지스터 파일 | 주소, 인덱스, 중간 계산값 |
| Shared memory | 일반적으로 같은 block의 thread들 | SM 내부 메모리 | 타일 데이터, thread 간 통신 |
| Local memory | thread 전용 | 장치 메모리(캐시될 수 있음) | spill된 값, 큰 자동 변수, 일부 배열 |
| Global memory | 접근 권한이 있는 device thread들 | 장치 메모리와 캐시 계층 | 입력, 가중치, 출력, gradient, workspace |
| L1·L2 cache | 접근 경로와 캐시 정책에 따라 다름 | GPU 칩 내부 | 메모리 접근 지연과 트래픽 감소 |

이 가운데 가장 헷갈리기 쉬운 것이 local memory다. 이름의 "local"은 해당 thread만 접근할 수 있다는 논리적 범위를 가리킨다. SM 안에 작고 빠른 메모리가 따로 있는 것이 아니고, 데이터는 장치 메모리에 놓인다. 컴파일러는 레지스터에 담기 어려운 배열이나 구조체, 레지스터가 부족해 spill된 값을 여기에 둔다.

**Register spill 자체는 정상적인 컴파일 결과**다. spill이 일어나면 느려질 수는 있어도 잘못된 메모리 접근이 생기지는 않는다.[^local-memory]

Shared memory는 프로그램이 직접 데이터를 배치하고 동기화하는 공간이다. 합성곱이나 행렬곱 커널은 global memory에서 읽은 타일을 shared memory에 올려 두고 여러 thread가 재사용한다.

레지스터와 shared memory를 얼마나 쓰느냐에 따라 SM 하나에 동시에 올릴 수 있는 block 수가 정해진다. Thread 수 $T$가 32의 배수인 block을 가정하면, 상주 block 수의 상한을 단순화해 다음처럼 쓸 수 있다.

$$
B_{\mathrm{resident}}
\le
\min\left(
\left\lfloor \frac{R_{\mathrm{SM}}}{T r} \right\rfloor,
\left\lfloor \frac{S_{\mathrm{SM}}}{s} \right\rfloor,
\left\lfloor \frac{T_{\mathrm{SM}}}{T} \right\rfloor,
B_{\max}
\right)
$$

여기서 $r$은 thread당 32비트 레지스터 수, $s$는 block당 shared memory 사용량이다. $R_{\mathrm{SM}}$, $S_{\mathrm{SM}}$, $T_{\mathrm{SM}}$은 각각 SM에서 쓸 수 있는 레지스터 수, shared memory 용량, 상주 thread 수의 한계이고, $B_{\max}$는 아키텍처가 정한 상주 block 수의 한계다. 상주 warp 수의 상한은 여기에 block당 warp 수 $T/32$를 곱한 값이다. 실제 배치는 레지스터 할당 단위 같은 다른 제약도 받으므로 이 식으로 occupancy를 정확히 계산할 수는 없다. 그래도 커널 구현이 바뀌면 네 항이 함께 바뀐다는 점은 알 수 있다. 수학적으로 같은 연산이라도 GPU에서의 자원 배치와 메모리 접근 순서는 달라진다. 뒤에서 cuDNN 커널을 비교할 때 이 식을 다시 쓴다.[^resident-blocks]

Shared memory의 bank conflict는 오류와 구분해야 한다. 32비트 접근으로 단순화하면 bank 번호는 다음과 같이 정해진다.

$$
\operatorname{bank}(a)
=
\left\lfloor \frac{a}{4} \right\rfloor \bmod 32
$$

32×32 `float` 배열의 한 열을 lane 32개가 읽으면 접근 간격이 32 word가 되어, 요청이 모두 같은 bank의 서로 다른 주소로 몰린다. 행 길이를 33으로 늘리면 요청이 여러 bank로 흩어진다. bank conflict는 유효한 접근이 직렬화돼 느려지는 성능 문제다. 접근이 비효율적이라고 SM Warp Exception이 나지는 않는다.[^bank-conflict]

코드로 보면 다음과 같다. thread 32개짜리 block 하나(`<<<1, 32>>>`)로 실행한다.

```cpp
template <int Pitch>
__global__ void read_shared_column(float* out)
{
    static_assert(Pitch == 32 || Pitch == 33, "Use a demonstrated pitch");
    __shared__ volatile float tile[32][Pitch];
    const unsigned int lane = threadIdx.x;
    for (int row = 0; row < 32; ++row) {
        tile[row][lane] = static_cast<float>(row * 32 + lane);
    }
    __syncthreads();
    out[lane] = tile[lane][0];
}
```

마지막 줄에서 lane이 읽는 bank는 `Pitch=32`이면 `(lane × 32) mod 32 = 0`, `Pitch=33`이면 `(lane × 33) mod 32 = lane`이다. 앞의 경우 32개 lane이 모두 bank 0으로 몰리고, 뒤의 경우 서로 다른 bank로 흩어진다. 그래도 결과는 두 경우 모두 `out[lane] = lane × 32`로 같다. `volatile`은 예제의 shared memory 접근이 최적화로 사라지지 않게 하려는 것이고, 동기화를 대신하지는 않는다.

## 같은 텐서, 다른 주소: channels-last와 메모리 coalescing

이번 장애는 `channels_last`를 끄면 재현되지 않았다. 레이아웃 하나로 왜 이렇게 결과가 달라지는지 주소 계산부터 보자.

PyTorch의 channels-last는 4차원 텐서의 논리적 차원 순서는 그대로 두고 메모리 stride만 바꾼다.

```python
import torch

x = torch.empty((2, 64, 32, 32), dtype=torch.bfloat16)
y = x.to(memory_format=torch.channels_last)

print(x.shape, x.stride())
print(y.shape, y.stride())
```

실행 결과는 다음과 같다.

```text
contiguous:
shape  = (2, 64, 32, 32)
stride = (65536, 1024, 32, 1)

channels_last:
shape  = (2, 64, 32, 32)
stride = (65536, 1, 2048, 64)
```

두 텐서의 shape은 같지만, $(n,c,h,w)$ 원소의 byte 주소를 계산하는 방식은 다르다.

$$
a(n,c,h,w)
=
a_{\mathrm{base}}
+
e\left(
n s_N+c s_C+h s_H+w s_W
\right)
$$

여기서는 storage 시작 주소를 $a_{\mathrm{base}}$로 두고, storage offset이 0인 텐서를 가정했다. $e$는 원소 크기로, BF16에서는 2byte다. 채널 인덱스가 하나 늘 때 주소는 contiguous에서 2,048byte, channels-last에서 2byte 증가한다.[^channels-last]

$(n,h,w)$를 고정하고 lane 32개가 연속된 채널을 읽는 가상의 커널을 생각해 보자. base 주소가 적절히 정렬돼 있다고 가정하면 다음과 같은 차이가 생긴다.

| 레이아웃 | lane 사이 주소 간격 | 접근하는 서로 다른 32byte 영역 수 |
|---|---:|---:|
| Contiguous NCHW | 2,048byte | 32개 |
| Channels-last | 2byte | 2개 |

![NCHW와 channels-last에서 채널을 읽는 warp의 주소 간격](assets/gpu-sm-warp-channels-last.svg)

*그림 2. shape이 같아도 stride가 달라지면 warp가 접근하는 32byte 영역의 수가 달라진다. 가정한 lane 배치에서 주소를 계산해 그린 예제다.*

GPU는 warp 안의 주소들을 32byte 단위 영역(sector)으로 묶어 메모리 요청을 만든다. 같은 32개 원소를 읽더라도 2개 영역으로 끝나느냐 32개 영역이 필요하냐에 따라 메모리 트랜잭션 수가 크게 달라진다. 이것이 coalescing이다.[^coalescing]

### CUDA로 lane별 주소 표현하기

같은 계산을 CUDA 커널로 쓰면 다음과 같다. BF16과 폭이 같은 16bit 원소를 읽기만 하는 설명용 커널이다. 이 커널도 `<<<1, 32>>>`로 실행한다.

```cpp
extern "C" __global__ void read_channel_warp(
    const unsigned short* x,
    unsigned long long stride_c,
    unsigned short* values,
    unsigned long long* byte_offsets)
{
    const unsigned int lane = threadIdx.x;
    const unsigned long long index = lane * stride_c;
    values[lane] = x[index];
    byte_offsets[lane] = index * sizeof(unsigned short);
}
```

```cpp
read_channel_warp<<<1, 32>>>(x_nchw, 1024, values_a, offsets_a);
read_channel_warp<<<1, 32>>>(x_nhwc,    1, values_b, offsets_b);
```

호출 부분만 발췌했고 메모리 할당, 초기화, 오류 검사는 생략했다. 두 입력 버퍼에는 같은 논리적 텐서를 각각의 레이아웃으로 저장해야 한다. 같은 버퍼에서 stride만 바꾸면 서로 다른 원소를 읽게 된다.

```text
NCHW:          0, 2048, 4096, …, 63488 bytes → 32byte 영역 32개
channels_last: 0, 2, 4, …, 62 bytes          → 32byte 영역 2개
```

이 예제와 앞의 bank 예제는 Blackwell GPU에서 실행해 출력 값과 주소를 확인했다. 두 레이아웃에서 읽은 값은 같았다. 영역 수는 주소로 계산한 값이고, 성능 카운터로 메모리 트랜잭션 수를 측정하지는 않았다.

실제 cuDNN 커널의 lane 배치는 이 예제와 다를 수 있고, 실제 트래픽은 캐시 재사용, 벡터화, 타일 배치의 영향도 받는다. 또 입력 텐서의 채널이 적더라도 합성곱을 거친 중간 feature map은 채널이 많으므로, 입력 텐서 하나의 레이아웃만 보고 전체 학습의 메모리 접근을 판단하기는 어렵다.

레이아웃의 영향은 라이브러리 안에서 더 커진다. 레이아웃과 자료형이 바뀌면 cuDNN이 고르는 구현 자체가 바뀔 수 있고, 그러면 다음 요소가 함께 달라진다.

- 합성곱 구현과 타일 크기
- 벡터화된 load·store의 폭과 정렬 조건
- Shared memory 배치와 파이프라인 단계 수
- Workspace 크기와 사용 방식
- 레지스터 압력과 상주 warp 수
- Tensor Core 연산과 reduction 순서

## cuDNN은 같은 합성곱에 어떤 커널을 고르는가

### 연산 그래프에서 실행 계획까지

cuDNN은 여러 단계를 거쳐 합성곱을 실행할 커널을 정한다. 먼저 연산을 operation graph로 기술하고, 그 그래프를 실행할 수 있는 **engine** 후보를 찾는다. engine은 특정 형태의 연산을 실행하는 구현이고, 각 engine에는 타일 크기, split-K, workspace 사용 방식 같은 세부 설정인 **knob**이 있다. engine과 knob 값을 정한 것이 engine configuration이고, 이를 실제 handle과 tensor에 맞춰 확정한 것이 **execution plan**이다.[^cudnn-graph]

Execution plan은 shape·stride·dtype 같은 tensor descriptor에 맞춰 만들어지고, 실제 데이터와 workspace의 포인터는 실행할 때 variant pack으로 따로 넘긴다. 이 구분은 뒤에서 PyTorch 없이 cuDNN을 직접 호출하는 재현 코드에서 다시 나온다.

어떤 계획이 선택될지는 heuristic, 지원 조건, workspace 제한, 수치적 특성에 따라 정해진다. PyTorch의 `torch.backends.cudnn.benchmark`가 `False`(기본값)여도 커널 선택은 일어난다. 이때는 heuristic이 추천한 후보를 쓰고, `True`이면 입력 shape마다 여러 후보를 실제로 실행해 본 뒤 가장 빠른 것을 쓴다.[^pytorch-conv] 어느 쪽이든 shape, stride, 자료형, GPU 아키텍처, cuDNN 버전이 바뀌면 다른 계획이 선택될 수 있다.

`torch.compile`을 쓰지 않는 eager 실행도 이 선택 과정을 똑같이 거친다. eager 모드에서 실패했다고 해서 cuDNN 내부의 구현 선택이나 코드 생성 경로를 조사 대상에서 빼면 안 된다.

### 선택된 계획과 커널을 관찰하는 방법

cuDNN이 실제로 무엇을 골랐는지는 로그와 프로파일러로 확인할 수 있다. cuDNN backend API 로그에는 descriptor와 API 호출 문맥이, frontend 로그에는 연산 그래프와 실행 계획이 남는다.[^cudnn-logging][^cudnn-frontend]

```bash
export CUDNN_LOGLEVEL_DBG=3                  # 0: 끔, 1: 오류, 2: 경고, 3: 정보
export CUDNN_LOGDEST_DBG=cudnn_api_%i.log    # %i는 프로세스 ID
export CUDNN_FRONTEND_LOG_INFO=1
export CUDNN_FRONTEND_LOG_FILE=cudnn_frontend.log
python repro.py
```

로그 양이 많고 실행이 느려지므로 재현용 실행에서만 켜는 것이 좋다.

실제로 실행된 GPU 커널의 이름과 launch 구성은 프로파일러 trace에 남는다. PyTorch profiler가 내보낸 trace의 커널 이벤트에는 grid, block, thread당 레지스터 수, shared memory 사용량이 함께 기록된다.

```python
from torch.profiler import profile, ProfilerActivity

# x, w는 requires_grad=True인 입력·가중치, dy는 출력 gradient
with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA]) as prof:
    y = torch.nn.functional.conv2d(x, w)
    y.backward(dy)
    torch.cuda.synchronize()

prof.export_chrome_trace("trace.json")
```

더 깊이 보려면 NVIDIA의 Nsight 도구를 쓴다. **Nsight Systems**는 CPU 쪽 CUDA API 호출, GPU 커널 실행, NVTX 범위를 하나의 timeline에 기록한다. **Nsight Compute**는 커널 하나를 여러 번 재실행(replay)하면서 launch 구성, occupancy, 메모리 트래픽, warp 상태, SASS를 수집한다.

```bash
# 수집 구간은 코드에서 torch.cuda.profiler.start() / stop()으로 지정한다
sudo ncu --profile-from-start off \
    --section LaunchStats --section Occupancy \
    --section MemoryWorkloadAnalysis_Tables --section WarpStateStats \
    -o conv_report python repro.py

# report에 담긴 커널의 SASS 보기
ncu -i conv_report.ncu-rep --page source --print-source sass
```

PyTorch 역전파를 Nsight Compute로 수집할 때는 다음을 알아 두면 시행착오를 줄일 수 있다.[^ncu-cli][^ncu-guide]

- **역전파 커널은 다른 CPU thread에서 launch된다.** NVTX 범위는 thread마다 따로 관리되므로, forward를 감싼 NVTX 범위로 수집 대상을 거르면 역전파 커널이 빠진다. 이번 조사에서도 첫 시도에는 forward 커널 하나만 수집됐다. `--profile-from-start off`와 `torch.cuda.profiler.start()`/`stop()`(내부적으로 `cudaProfilerStart`/`cudaProfilerStop`)으로 구간을 지정하면 프로세스 전체에 적용된다.
- **성능 카운터 권한이 필요할 수 있다.** GPU 성능 카운터가 관리자 전용으로 설정된 시스템(`RmProfilingAdminOnly: 1`)에서는 Nsight Compute를 root로 실행해야 한다. 그렇지 않으면 `ERR_NVGPUCTRPERM` 오류가 난다.
- **측정 조건이 실제 학습과 다르다.** Nsight Compute는 기본적으로 커널을 재실행할 때마다 캐시를 비운다(`--cache-control all`). 그래서 캐시 지표는 cold cache 기준이고, 데이터가 캐시에 남아 있는 실제 학습과 다르다. 실행 시간도 계측 오버헤드와 클럭 설정(`--clock-control`)의 영향을 받으므로 학습 속도 비교 근거로 쓰지 않는다.
- 이번에 쓴 Nsight Compute 2026.3은 기본 report 확장자가 `.ncu-repz`였다. 출력 파일 이름을 가정하는 스크립트는 이 점을 확인해야 한다.

### 사례: cuDNN 9.10과 9.26·9.27의 선택 차이

cuDNN 버전에 따라 커널 선택이 어떻게 달라지는지 보기 위해, RTX 5090 비교 서버에서 드라이버, Python, PyTorch, cuBLAS를 그대로 두고 cuDNN 패키지만 9.10.2.21, 9.26.0.51, 9.27.0.42로 바꿔 가며 같은 연산을 실행했다. 각 시험은 새 프로세스에서 `cudnn.benchmark=False`, TF32 비활성화, seed 0으로 실행했다. 대상은 장애 초기에 만든 재현 코드에 있던 BF16 1×1 합성곱으로, 채널 수를 줄이는 층이다.

```text
X  = [N, C, H, W], BF16, channels_last    # N = 4096
W  = [K, C, 1, 1], BF16, channels_last
dY = [N, K, H, W], BF16, channels_last

Y = conv2d(X, W)
dX, dW = autograd.grad(Y, (X, W), dY)
```

아래에서는 batch를 4096으로 키운 이 실행을 "큰 batch", 실제 학습과 같은 batch 크기로 실행한 경우를 "작은 batch"라고 부른다.

이 연산은 뒤에서 실패 후보로 좁혀지는 연산과 다르다. 장애 서버에서도 cuDNN 9.10으로 문제없이 실행됐다([실패한 실행 추적하기](#실패한-실행-추적하기-nsight-systems로-좁힌-dw-경로) 참고). 여기서는 cuDNN 버전에 따라 커널 구성이 얼마나 달라지는지 보는 예로 쓴다.

선택된 실행 계획은 다음과 같았다. `eng63_k25=2`는 "engine 63, knob 25의 값 2"로 읽는다.

| 단계 | cuDNN 9.10 | cuDNN 9.26 및 9.27 |
|---|---|---|
| Forward | `eng22_k2=2_k13=0_k14=3_k18=0_k23=1` | `eng58_k25=2` |
| Backward-data, dX | `eng63_k25=0` | `eng63_k25=2` |
| Backward-filter, dW | `eng62_k25=1` | `eng62_k25=2` |

![cuDNN 버전에 따른 forward와 backward-data 실행 경로](assets/gpu-sm-warp-cudnn-plans.svg)

*그림 3. batch 4096 최소 연산에서 직접 관측한 선택이다. dW 단계는 그림에서 생략했다. engine 번호가 같아도 configuration에 따라 다른 커널이 실행될 수 있다.*

Forward는 engine 22의 XMMA 구현에서 engine 58의 CUTLASS WMMA 구현으로 바뀌었다. Backward-data는 engine 번호가 63으로 같았지만 실제로는 다른 커널이 실행됐다.

```text
9.10:
cutlass_80_tensorop_bf16_s16816gemm_relu_bf16_256x128_32x3_nn_align8

9.26 / 9.27:
cutlass_80_tensorop_bf16_s16816gemm_relu_bf16_64x64_32x6_nn_align8
```

| dX 커널의 launch 정보 | 9.10 | 9.26 및 9.27 |
|---|---:|---:|
| Grid | 4096×1×1 | 16384×2×1 |
| Block당 thread | 256 | 128 |
| Thread당 레지스터 | 218 | 96 |
| Block당 shared memory | 72KiB | 48KiB |
| 실행 계획 workspace | 0byte | 0byte |

### 커널 이름에서 자원 사용량 읽어 내기

긴 커널 이름은 암호처럼 보이지만, cuDNN이 쓰는 CUTLASS 계열 커널은 이름에 구현 정보가 상당 부분 들어 있다. CUTLASS의 명명 규칙에 따라 읽으면 다음과 같다.

| 표기 | 의미 |
|---|---|
| `cutlass_80` | CUTLASS의 SM80(Ampere) 계열 구현 이름 |
| `tensorop` | Tensor Core를 사용 |
| `bf16` | 입출력 자료형 |
| `s16816gemm` | FP32(`s`)로 누산하고, 16×8×16 크기의 Tensor Core 행렬곱 명령을 사용하는 GEMM |
| `256x128_32x3` | thread block 하나가 256×128 출력 타일을 맡고, K 방향으로 32씩 읽으며, 3단 파이프라인을 사용 |
| `nn` | 두 입력 행렬의 메모리 레이아웃 |
| `align8` | 8원소, 즉 BF16 기준 16byte 단위로 정렬된 벡터 접근 |

다른 커널 이름에서도 비슷한 표기를 볼 수 있다. `dgrad`와 `wgrad`는 각각 입력 gradient(dX)와 가중치 gradient(dW)를 계산하는 커널, `implicit_gemm`은 im2col 행렬을 따로 만들지 않고 합성곱을 GEMM처럼 계산하는 방식, `nhwc`는 channels-last 레이아웃을 뜻한다.

`relu`처럼 이 규칙으로 설명되지 않는 표기는 여기서 해석하지 않는다. 이름에 `relu`가 들어 있다고 모델에 ReLU가 추가된 것도 아니다. `sm80`이나 `cutlass_80`은 구현 계열의 이름이다. 이 문자열만 보고 SM80용 binary가 Blackwell에서 그대로 실행됐다고 판단할 수는 없고, 실제로 로딩된 binary의 타깃은 따로 확인해야 한다.[^binary-compat] TF32 경로에서는 `s1688gemm`처럼 명령 shape가 16×8×8로 바뀌고, FP32 원소 4개(16byte) 단위로 정렬된 접근은 `align4`로 표시된다.

이 해석이 맞는지는 shared memory 사용량으로 확인해 볼 수 있다. 이런 multistage GEMM 커널은 A 타일($M_{\mathrm{tile}}\times K_{\mathrm{tile}}$)과 B 타일($N_{\mathrm{tile}}\times K_{\mathrm{tile}}$)을 파이프라인 단계 수만큼 shared memory에 미리 올려 둔다.

$$
s
\approx
\left(M_{\mathrm{tile}}+N_{\mathrm{tile}}\right)
K_{\mathrm{tile}}\,
e\,
n_{\mathrm{stages}}
$$

| 커널 | 계산 | 결과 | 관측값 |
|---|---|---:|---:|
| `256x128_32x3` (9.10 dX, 큰 batch) | (256 + 128) × 32 × 2byte × 3 | 73,728byte | 72KiB |
| `64x64_32x6` (9.26·9.27 dX, 큰 batch) | (64 + 64) × 32 × 2byte × 6 | 49,152byte | 48KiB |
| `64x256_32x4` (9.10 dX, 작은 batch) | (64 + 256) × 32 × 2byte × 4 | 81,920byte | 80KiB |
| `128x64_64x3` (9.10 dW, 뒤에서 다룸) | (128 + 64) × 64 × 2byte × 3 | 73,728byte | 72KiB |
| `128x128_16x5` (TF32 forward, 뒤에서 다룸) | (128 + 128) × 16 × 4byte × 5 | 81,920byte | 80KiB |

다섯 커널 모두 계산값이 관측값과 일치한다. TF32 커널은 FP32 원소를 그대로 저장하므로 원소 크기 $e$가 4byte다. 구조가 다른 커널에는 이 식이 그대로 맞지 않는다. 9.26·9.27이 작은 batch에서 고른 WMMA 커널 `32x32_32x1`은 이 식으로 4KiB지만 관측값은 5KiB였다.

레지스터도 비슷하게 짐작할 수 있다. 출력 타일을 block의 thread에 고르게 나누면 9.10 커널은 thread마다 256×128 / 256 = 128개, 새 커널은 64×64 / 128 = 32개의 FP32 누산값을 들고 있어야 한다. 관측된 thread당 레지스터 218개와 96개 가운데 상당 부분이 이 누산기라는 뜻이다.

### Nsight Compute로 측정한 occupancy, spill, 캐시

앞의 상주 block 식으로 이론 상한을 계산할 수도 있지만, Nsight Compute로 측정하면 짐작할 필요가 없다. 비교 서버에서 큰 batch의 dX 커널을 측정한 값은 다음과 같다. Achieved occupancy는 버전별 5회 측정의 중앙값이다.

| 항목 | 9.10 `256x128_32x3` | 9.26·9.27 `64x64_32x6` |
|---|---:|---:|
| 레지스터 기준 SM당 block 상한 | 1 | 5 |
| Shared memory 기준 SM당 block 상한 | 1 | 2 |
| 이론적 occupancy | 16.67% | 16.67% |
| Achieved occupancy | 16.58% | 15.39% |
| Local memory load/store sector | 0 / 0 | 0 / 0 |

레지스터 사용량은 block당 55,808개(256 × 218)에서 12,288개(128 × 96)로 크게 줄었지만, 이번에는 shared memory가 새 제약이 되어 이론적 occupancy는 똑같다. 9.10은 SM당 block 1개 × warp 8개, 새 커널은 block 2개 × warp 4개로, 둘 다 SM당 최대 48개 warp 가운데 8개다. Block 수가 늘어도 상주 warp 수는 그대로다. 참고로 드라이버가 block마다 shared memory 1KiB를 따로 잡으므로, 실제 요구량은 커널이 선언한 양보다 조금 크다.

달라진 것은 **작업을 쪼개는 방식**이다. 큰 block이 큰 타일을 3단 파이프라인으로 처리하던 구조가, 작은 block 여러 개가 작은 타일을 6단 파이프라인으로 처리하는 구조로 바뀌었다. Grid도 4,096개 block에서 32,768개 block으로 늘었다.

thread당 레지스터 218개는 많아 보이지만 **spill은 없었다.** Local memory load/store는 세 버전 모두 0이었고, SASS에도 local memory 명령(`LDL`, `STL`)이 없었다. 레지스터 수만 보고 spill을 짐작하지 말고 local memory 트래픽이나 SASS로 확인해야 한다. 직접 빌드하는 커널이라면 `nvcc -Xptxas -v` 출력의 spill stores/loads 값으로도 확인할 수 있다.

캐시와 warp 상태 지표는 좋아진 것과 나빠진 것이 섞여 있었다. 새 커널은 L2 read hit rate가 80.05%에서 84.80%로 올랐지만, global load sector 수는 약 334만에서 747만으로 늘었고, 메모리 결과를 기다리는 long scoreboard stall(발행 명령당 cycle)도 1.19에서 2.28로 늘었다. Long scoreboard는 메모리 응답을 기다리는 상태이고, 잘못된 주소 접근과는 관계가 없다. 이 값들도 캐시를 비우는 replay 조건에서 측정했다.

**batch만 바꿔도 결과가 달라진다.** 같은 연산을 실제 학습과 같은 작은 batch로 실행하면 dX에 전혀 다른 커널이 선택된다. 아래 achieved occupancy는 버전별 1회 측정값이다.

| 항목 | 9.10 `tensorop 64x256_32x4` | 9.26·9.27 `wmma 32x32_32x1` |
|---|---:|---:|
| Thread당 레지스터 | 242 | 46 |
| Block당 shared memory | 80KiB | 5KiB |
| 레지스터 기준 SM당 block 상한 | 2 | 10 |
| Shared memory 기준 SM당 block 상한 | 1 | 16 |
| 이론적 occupancy | 8.33% | 83.33% |
| Achieved occupancy | 8.29% | 69.6~69.7% |

큰 batch에서는 occupancy가 그대로였지만 작은 batch에서는 10배로 뛰었다. 같은 연산이라도 shape에 따라 heuristic이 다른 타일을 고르고, 상주 block 수를 제한하는 자원도 달라진다. 물론 이론적 occupancy의 비율이 곧 속도의 비율은 아니다.

실제 학습에 해당하는 것은 작은 batch 쪽이다. 실제 모델의 Nsight Systems trace에서 NVTX로 이 합성곱을 찾아보니 커널 이름, grid·block, 레지스터, shared memory가 작은 batch의 최소 연산과 모두 일치했다. 반대로 큰 batch에서 본 `256x128_32x3` dX 커널은 실제 모델 trace에 한 번도 나오지 않았다. 재현 코드를 만들 때 shape, stride, 자료형을 실제 학습과 정확히 맞춰야 하는 이유다.

**9.26과 9.27은 SASS까지 같았다.** Nsight Compute report에 담긴 SASS에서 실행 시 주소(PC)를 함수 안의 상대 위치로 바꾸고 branch 대상 주소도 같은 방식으로 정규화한 뒤 비교했다. 두 batch 크기의 forward, dX, dW, reduction 8개 커널 모두 명령과 피연산자열의 해시가 같았다. 이름과 launch 정보가 같다는 것보다 강한 증거지만, cuDNN 전체 binary나 host 쪽의 계획 선택, workspace 관리까지 같다는 뜻은 아니다.

정리하면 cuDNN 버전에 따라 타일 구성, 파이프라인 단계, 메모리 요청 패턴이 크게 달라진다. 같은 수학 연산이라도 오류를 드러내는 실행 조건이 달라질 여지는 충분하다. 하지만 측정한 커널에는 spill이 없었고 occupancy 변화도 shape마다 달랐다. "레지스터 spill이나 낮은 occupancy가 원인"이라는 설명은 측정 결과와 맞지 않는다.[^ncu-guide]

### 실행 계획 이름만으로 판단하지 않기

실행 계획 문자열과 실제 커널은 1:1로 대응하지 않는다. 이번 비교에서도 몇 가지 함정이 있었다.

- `k25`는 공개 enum의 `CUDNN_KNOB_TYPE_WORKSPACE`에 해당한다. 그렇다고 `k25=0 → 2`를 workspace가 2byte로 늘었다고 읽으면 안 된다. dX 실행 계획이 보고한 workspace는 두 경우 모두 0byte였다.[^cudnn-knob]
- dW는 knob 값이 `k25=1`에서 `k25=2`로 달라졌는데도 같은 주 커널(`cutlass_80_tensorop_s16816gemm_bf16_64x64_32x6_nt_align8`)과 split-K reduction을 실행했고, workspace도 1,880,320byte로 같았다.
- 9.26과 9.27은 실행 계획, 커널 이름, launch 정보, SASS가 모두 같았다. 따라서 이 선택 변화는 9.27에서 처음 생긴 것이 아니다.

## 오류 로그 읽기: SM 예외와 MMU fault

이제 처음의 로그로 돌아가 보자. 이 로그에는 서로 다른 계층에서 나온 두 종류의 보고가 섞여 있다.

첫 줄의 `Graphics SM Warp Exception: Out Of Range Address`는 SM이 명령을 실행하다가 발견한 예외다. CUDA-GDB 문서는 `Warp Out of range Address`를 warp 안의 어떤 thread가 local 또는 shared memory 영역의 유효 범위를 벗어난 주소에 접근한 경우로 설명한다. global memory까지 포함하는 잘못된 접근은 `Warp Illegal Address`로 따로 분류한다. 이 설명으로 조사할 주소 공간을 좁혀 볼 수는 있지만, 드라이버 로그(Xid)와 CUDA-GDB의 예외는 분류 체계가 달라서 Xid 문구만으로 정확한 명령, lane, 주소 공간까지 확정할 수는 없다.[^cuda-gdb-errors]

배열의 논리적 경계와 하드웨어가 검사하는 주소의 유효 범위도 서로 다르다. 텐서의 끝을 넘어선 주소라도 여전히 매핑된 메모리 안에 있을 수 있다. 그런 접근은 결과를 망가뜨리면서도 아무 예외 없이 지나갈 수 있다. 예외가 났다는 것은 하드웨어가 검사하는 범위까지 벗어났다는 뜻이다.

둘째 줄의 `faulted @ 0x0_00000000`과 `FAULT_PDE`는 MMU가 보고한 GPU 메모리 page fault, 즉 Xid 31이다. GPU 명령이 쓰는 가상주소는 page table과 TLB를 거쳐 물리 메모리 위치로 변환되는데, 이 변환이 실패했다는 뜻이다. 주소가 `0x0`이라고 해서 GDDR 메모리의 0번지 셀이 고장 났다고 읽으면 안 된다. Null pointer, 손상된 포인터, 잘못된 주소 계산, 드라이버나 하드웨어 문제 가운데 무엇인지 가리려면 접근을 수행한 명령과 그 포인터가 만들어진 경로를 알아야 한다. `GPCCLIENT_T1_13`은 보고된 client 식별자다. 이 이름이 `GPC2/TPC6/SM1`과 물리적으로 어떻게 대응하는지는 이번에 검증하지 않았다.[^virtual-memory]

자주 마주치는 Xid를 관측 계층별로 정리하면 다음과 같다.[^xid]

| Xid | 관측 계층 | 의미 | 읽을 때 주의할 점 |
|---|---|---|---|
| 13 | SM의 명령 실행 | 명령 실행 중 예외. SM Warp Exception이 여기에 해당 | 잘못된 접근을 실행한 SM이다. 주소를 만든 곳과는 다를 수 있다 |
| 31 | MMU의 주소 변환 | GPU 가상주소 변환 실패(page fault) | 보고된 주소는 가상주소다. 물리 메모리 셀의 위치가 아니다 |
| 109 | 드라이버의 context 전환 | Context switch timeout | 앞선 오류의 후속으로 나타날 수 있다. NVIDIA는 GPU reset을 안내한다 |
| 79 | PCIe 연결 | GPU가 PCIe 버스에서 사라짐 | 장치 연결 문제로, SM 예외와는 다른 실패 양상이다 |

메모리 데이터의 비트 오류도 다른 체계에서 관측된다. RTX Blackwell 백서는 GDDR7의 on-die 단일 비트 오류 정정 기능을 소개하지만, 이런 보호 기능과 Xid의 주소 접근 예외는 별개다. Xid 13을 ECC 오류 카운터처럼 읽어서는 안 된다.

BF16을 의심할 때도 같은 구분이 필요하다. BF16의 반올림 오차와 잘못된 메모리 주소 접근은 전혀 다른 현상이다. Mixed precision은 특정 커널이 선택되는 조건이 될 수는 있지만, "정밀도가 낮아서 illegal address가 발생했다"는 설명으로는 주소가 어떻게 잘못 계산됐는지 알 수 없다.

## 같은 SM에서 반복된다는 것은 얼마나 강한 증거인가

초기 조사에서 보존한 로그에는 Graphics SM Warp Exception이 73행 있었고, 모두 `GPC2/TPC6/SM1`을 가리켰다. 교체 전후로 범위를 넓혀 다시 모으자 교체 후 104행이 모두 같은 좌표였다. 한 좌표에 이만큼 몰렸다면 조사해 볼 만하다. 하지만 두 숫자는 수집 범위가 다른 로그의 행 수이고, 다음과 같은 이유로 독립적인 고장 횟수나 실패율로 읽을 수 없다.

- 장애 하나에서 보고가 여러 건 나올 수 있다.
- Workload와 자원 조건이 비슷하면 block 배치도 매번 비슷해질 수 있다.
- 앞선 fault가 남긴 GPU 상태가 이후 실패에 영향을 줄 수 있다.

"모든 SM에서 같은 확률로 독립적으로 오류가 난다면 한 SM에 104번 몰릴 확률은 극히 낮다"는 식의 계산은 오류가 서로 독립이라는 가정부터 입증해야 성립한다.

물리 좌표를 해석할 때도 주의해야 한다. PTX의 `%smid`는 값을 읽는 시점에 thread가 실행 중인 SM 번호를 알려주지만, 번호가 연속적이라는 보장은 없고 선점 뒤 재스케줄링 같은 상황에서는 값이 바뀔 수도 있다. 드라이버 로그의 GPC·TPC 기준 좌표를 `%smid` 같은 전역 SM 번호로 바꾸려면 따로 검증이 필요하다.[^smid]

하드웨어 가설을 판단할 때는 반복 횟수보다 **조건을 바꿔도 같은 위치에서 실패하는가**를 봐야 한다. 서로 다른 workload에서, 매번 깨끗한 초기 상태에서, 소프트웨어 경로를 바꿔도 같은 SM에서 실패한다면 하드웨어 쪽 증거가 강해진다. 반대로 실행 경로를 바꾸자 실패가 사라졌다면, 소프트웨어 결함과 하드웨어의 특정 취약 경로를 모두 후보로 남겨 둬야 한다. 이번 사례가 그랬다. cuDNN을 바꾸자 BF16 학습의 실패는 사라졌지만, TF32 조건에서는 같은 좌표의 오류가 다시 나타났고, 장비를 교체한 뒤에야 그 조건도 통과했다. 뒤에서 차례로 다룬다.

## 비동기 실행과 오류 이후의 GPU 상태

### 오류는 늦게 보고된다

CUDA 연산은 기본적으로 비동기로 실행된다. Python이 GPU 연산을 요청한 시점과 GPU가 그 연산을 마치는 시점이 다르기 때문에, 오류가 한참 뒤의 API 호출에서야 드러날 수 있다. 이번에도 일반 실행에서는 오류와 관계없어 보이는 데이터 처리 쪽 스택이 찍혔지만, `CUDA_LAUNCH_BLOCKING=1`로 실행하자 `loss.backward()` 안의 cuDNN 실행 실패로 범위가 좁혀졌다.[^pytorch-async]

`loss.backward()`까지 좁혔다고 원인 위치를 찾은 것은 아니다. 역전파에는 여러 연산과 커널이 들어 있다. 동기화를 강제하면 실행 타이밍도 달라지므로, 동기 실행에서 본 결과를 원래 실행에 그대로 적용할 수도 없다. 또 비동기 실행에서는 커널 launch API가 성공을 반환해도 그 커널이 GPU에서 끝까지 실행됐는지 알 수 없다. 어느 합성곱인지까지 좁히는 데는 뒤에서 다룰 연산 단위 추적이 필요했다.

### 오류는 프로세스와 GPU에 남는다

Illegal address 오류가 나면 프로세스의 CUDA context는 일관성이 깨진 상태로 남고, 이후의 CUDA 호출도 같은 오류를 반환한다. 이 상태에서는 프로세스를 종료하고 다시 시작해야 한다. 여기에 Xid 109 같은 후속 이벤트가 이어지면 NVIDIA는 GPU reset까지 안내한다. 이번 장비에서는 해당 GPU가 primary GPU라 단독 reset이 거부돼 서버를 재부팅해야 했다.[^illegal-address]

프로세스 재시작과 GPU reset은 다르다. `nvidia-smi` 조회가 성공하거나 간단한 연산이 통과했다고 해서 앞선 오류의 영향이 모두 사라졌다고 볼 수는 없다. `nvidia-smi`의 `GPU Recovery Action` 필드도 지금 필요한 조치를 알려줄 뿐, 과거 특정 시점의 상태를 되짚어 주지는 않는다.[^nvidia-smi]

### 초기 상태도 실험 조건이다

이번 조사에서 이 점을 실감한 일이 있었다. 조사 도중 새 cuDNN 환경으로 돌린 야간 시험이 실패했다는 기록을 발견했다. 처음에는 9.27도 소용없다는 증거처럼 보였다. 그러나 부팅 기록과 커널 로그를 맞춰 보니, 그 시험은 앞선 오류로 Xid 109가 여러 번 쌓인 뒤 GPU를 초기화하지 않은 상태에서 실행된 것이었다. 반면 9.27로 학습을 완주한 실행은 재부팅 직후, 첫 Xid가 나기 전이었다.

두 결과는 서로 다른 GPU 상태에서 나왔으므로 하나로 합쳐 판단할 수 없다. 야간 기록이 정상 상태의 9.27 실패를 증명하지도 않고, 그렇다고 모든 실패가 이전 오류의 잔여 영향 때문이라고 단정할 수도 없다. GPU 재현 실험에서는 초기 상태도 통제해야 할 실험 조건이다.

그렇다고 초기 상태만으로 9.27의 실패를 모두 설명할 수는 없었다. 뒤에서 다룰 TF32 조건은 드라이버를 올리고 새로 부팅해 이전 Xid가 하나도 없는 상태에서 돌린 첫 실행에서도 실패했다.

## 실패한 실행 추적하기: Nsight Systems로 좁힌 dW 경로

지금까지의 비교는 모두 정상적으로 끝난 실행을 관찰한 것이다. 정작 알고 싶은 것은 실패한 실행에서 GPU가 마지막으로 무엇을 하고 있었는가다. 장애 서버에서 cuDNN 9.10으로 실제 모델을 실행하면서 Nsight Systems로 이를 추적했다.

### 실패한 프로세스의 trace는 쉽게 사라진다

Nsight Systems는 CUDA API와 GPU 실행 기록을 버퍼에 모았다가 파일로 저장한다. GPU 오류로 프로세스가 비정상 종료되면 이 버퍼가 저장되지 않을 수 있다. 첫 시도에서 정상 실행(9.27)은 GPU 커널 기록이 수천 건 남았지만, 실패 실행(9.10)에는 초기 CUDA API 기록 몇 건만 남고 GPU 커널 기록은 하나도 없었다. 주기적으로 저장하는 옵션(`--cuda-flush-interval=100`, `--flush-on-cudaprofilerstop=true`)을 켜도 마찬가지였다. 이 옵션이 아직 다 차지 않은 버퍼까지 강제로 저장해 주지는 않는다.[^nsys]

### 연산마다 checkpoint를 둔다

그래서 합성곱 연산마다 경계를 두고, 경계에서 GPU 완료를 확인하고 trace를 저장하도록 바꿨다.

1. 연산 직전 `torch.cuda.synchronize()`로 앞선 GPU 작업이 끝났는지 확인하고, `cudaProfilerStop()`과 `cudaProfilerStart()`를 차례로 호출해 여기까지의 기록을 저장한다.
2. 연산 이름과 입력의 shape·stride·dtype을 로그와 NVTX에 남기고 연산을 실행한다.
3. 연산 뒤 다시 동기화해, 호출이 반환된 시점과 GPU 작업이 실제로 끝난 시점을 구분해 기록한다.
4. 감시 프로세스가 커널 로그에서 새 Xid를 감지하면 `nsys stop`으로 Nsight 세션을 먼저 끝내 report를 저장하고, 그다음에 시험 프로세스를 종료한다.

PyTorch에서는 `TorchDispatchMode`로 학습 코드를 고치지 않고 이런 경계를 넣을 수 있다. 역전파 연산은 autograd thread에서 실행되지만 이 방식으로 함께 잡힌다.

```python
import torch
from torch.utils._python_dispatch import TorchDispatchMode

CONV_OPS = {
    torch.ops.aten.convolution.default,
    torch.ops.aten.convolution_backward.default,
}

class ConvCheckpoint(TorchDispatchMode):
    def __init__(self):
        super().__init__()
        self.index = 0

    def __torch_dispatch__(self, func, types, args=(), kwargs=None):
        kwargs = kwargs or {}
        if func not in CONV_OPS:
            return func(*args, **kwargs)

        self.index += 1
        torch.cuda.synchronize()        # 앞선 GPU 작업이 끝났는지 확인
        torch.cuda.profiler.stop()      # 여기까지의 trace를 저장
        torch.cuda.profiler.start()

        tensors = [a for a in args if isinstance(a, torch.Tensor)]
        desc = [(tuple(t.shape), t.stride(), str(t.dtype)) for t in tensors]
        print(f"[{self.index}] start {func} {desc}", flush=True)

        with torch.cuda.nvtx.range(f"conv#{self.index}"):
            out = func(*args, **kwargs)  # 반환은 launch 요청이 끝났다는 뜻일 뿐이다
        torch.cuda.synchronize()        # GPU 작업이 실제로 끝났는지 확인
        print(f"[{self.index}] completed", flush=True)
        return out

with ConvCheckpoint():
    loss = model(x).sum()
    loss.backward()
```

이렇게 바꾸자 실패한 실행에서도 실패 직전까지의 GPU 커널과 CUDA API 기록이 남았다. checkpoint와 종료 순서를 함께 바꿨기 때문에, 어느 쪽 덕분인지는 가려내지 않았다.

### correlation ID로 API 호출과 GPU 실행을 잇는다

Nsight Systems는 CPU 쪽 CUDA API 호출과 그 호출로 생긴 GPU 실행 기록에 같은 correlation ID를 붙인다. 이 ID를 따라가면 "launch는 요청됐는데 GPU 실행 기록이 없는 커널"을 찾을 수 있다.

실패 실행은 첫 학습 step 도중 한 합성곱의 역전파 연산에서 멈췄다. 그 직전 연산까지는 GPU 완료와 저장이 끝났다. 멈춘 연산은 BF16, channels-last 텐서를 받는 1×1 합성곱의 역전파(`aten.convolution_backward.default`)로, 입력 gradient(dX)와 가중치 gradient(dW)를 함께 계산한다. checkpoint에 남긴 shape과 stride로 어느 층인지 특정했고, 앞에서 커널 선택을 비교한 최소 연산과는 다른 층이었다.

이 연산 안에서 관측된 순서는 다음과 같다.

1. 연산 전 동기화와 trace 저장이 성공했다.
2. dX 커널(`sm80_xmma_dgrad_implicit_gemm_indexed_..._tilesize128x32x32_stage4`)이 launch됐고, GPU 시작·종료 기록이 모두 남았다.
3. 이어서 `cudaMemsetAsync`와 커널 launch가 호출됐다. 마지막 launch는 성공(0)을 반환했지만, 대응하는 GPU 실행 기록은 없었다.
4. 연산 뒤 동기화가 끝나지 않았다. 커널 로그에는 `GPC 2 / TPC 6 / SM 1: Out Of Range Address`(Xid 13)가, 4초쯤 뒤에는 같은 프로세스의 Xid 109가 기록됐다.
5. cuDNN frontend 로그의 마지막 실행 계획은 가중치 gradient용인 `ConvBwdFilter_eng24_k0=5_k2=1_k5=4_k14=2`였다.

dX 커널은 끝났고, 그 뒤에 요청된 작업은 GPU 실행 기록이 없으며, 마지막 실행 계획은 dW를 가리킨다. 이 세 관측을 합치면 **이 합성곱의 dW 경로가 가장 유력한 실패 후보**다.

![cuDNN 9.10과 9.27에서 같은 역전파 연산의 관측 경계](assets/gpu-sm-warp-backward-boundary.svg)

*그림 4. 장애 서버에서 같은 역전파 연산을 cuDNN 9.10과 9.27로 실행했을 때의 관측 경계. 실선은 관측한 실행 순서이고, 점선은 두 경로를 비교해 얻은 추론이다.*

### 9.27은 같은 연산을 어떻게 계산했나

같은 서버에서 9.27로 같은 실행을 했을 때는 이 연산이 세 커널로 끝까지 완료됐다. 9.10의 dW 커널은 장애 서버에서 실행 기록이 남지 않았으므로, 비교 서버의 9.10 성공 trace에서 같은 연산에 쓰인 커널을 적었다.

```text
9.10 (dX는 장애 서버, dW는 비교 서버에서 관측):
  dX    sm80_xmma_dgrad_implicit_gemm_indexed_..._tilesize128x32x32_stage4
  dW    cutlass_tensorop_bf16_s16816wgrad_analytic_bf16_128x64_64x3_nhwc_align8

9.27 (장애 서버에서 완료):
  dX    sm80_xmma_dgrad_implicit_gemm_..._tilesize128x64x64_stage3
  dW    cutlass_80_tensorop_bf16_s16816gemm_relu_bf16_128x64_32x6_nt_align8
  합산  cublasLt::splitKreduce_kernel
```

9.10은 NHWC 텐서에서 바로 가중치 gradient를 계산하는 전용 wgrad 커널을 쓰고, 9.27은 dW를 일반 GEMM으로 계산한 뒤 부분합을 별도 커널로 합친다. 9.10의 wgrad 커널은 thread당 레지스터 168개, block당 shared memory 72KiB를 썼는데, 이 값은 앞의 shared memory 식으로 계산한 값((128 + 64) × 64 × 2byte × 3 = 72KiB)과 같다.

1×1 합성곱은 공간 위치마다 채널을 선형 변환하는 연산이라, batch와 공간 축을 $M = N\times H\times W$로 묶으면 행렬곱으로 볼 수 있다. $X$를 $M\times C$ 행렬로 펼치면 $Y = XW^{\top}$, $dX = dY\,W$, $dW = dY^{\top}X$다. 이 식은 연산의 의미를 나타낸 것이고, cuDNN이 꼭 GEMM 하나로 실행하지는 않는다.

9.27 경로의 split-K는 1×1 합성곱 dW의 모양을 보면 이해가 된다. dW를 원소 단위로 쓰면 다음과 같다.

$$
dW_{k,c}=\sum_{n,h,w} dY_{n,k,h,w}\,X_{n,c,h,w}
$$

이 층은 출력 dW가 작아서 128×64 타일로 나누면 수십 개뿐이다. 반면 합산 축 $N\times H\times W$는 수천으로 길다. 타일 수십 개로는 SM 170개를 다 채울 수 없다. split-K는 합산 축을 여러 조각으로 나눠 block마다 부분합을 계산하고, reduction 커널이 이를 합친다. 부분합을 담을 workspace가 필요하고, 합산 순서가 달라지므로 결과의 마지막 비트가 조금 달라질 수 있다.

### 이 추적으로 알 수 있는 것과 없는 것

이 추적으로 실패 범위는 크게 좁혔지만 원인까지 증명하지는 못했다.

- **launch 성공은 실행 성공이 아니다.** 비동기 launch API가 0을 반환했다면 요청이 큐에 들어갔다는 뜻이다. 반대로 GPU 실행 기록이 없다는 사실만으로는 어느 커널의 어느 명령이 잘못된 주소에 접근했는지 알 수 없다.
- **앞 연산이 정상이었다는 보장도 없다.** 직전 연산 뒤의 동기화가 성공했다면 그 연산은 오류 없이 끝난 것이다. 하지만 값까지 올바르게 만들었는지는 알 수 없다. 앞에서 본 것처럼 잘못된 주소는 다른 곳에서 만들어져 이 연산에서 소비됐을 수도 있다.
- **계측하면 실행이 달라진다.** checkpoint를 넣자 같은 9.27 실행의 GPU 커널 수가 약 9% 늘었다. 동기화가 들어가면서 실행 스케줄과 일부 커널 구성이 바뀐 것이다.
- **기록마다 시계가 다르다.** Nsight가 남긴 GPU 타임스탬프와 커널 로그의 수신 시각은 약 0.65초 어긋나 있었다. 서로 다른 시계를 빼서 나노초 단위의 인과관계를 주장할 수는 없다. 비정상 종료된 report에는 끝나지 않은 NVTX 범위에 다른 기준의 시각이 남기도 해서, 순서는 correlation ID와 checkpoint 기록으로 맞췄다.
- **초기 상태가 깨끗하지 않았다.** 이 추적은 앞선 Xid 109 이력이 남은 상태에서 재부팅 없이 진행했다.

한편 앞서 커널 선택을 비교한 최소 연산은 장애 서버에서도 cuDNN 9.10으로 통과했다. 실패는 실제 모델을 돌릴 때만 났다. 그러니 BF16 실패의 최소 재현은 이번에 좁힌 dW 연산으로 만들어야 한다. 이때 연산을 떼어 내면 cuDNN이 다른 실행 계획을 고를 수 있으므로, 분리한 재현에서도 같은 계획과 커널이 선택되는지 먼저 확인해야 한다.

우회 방법을 고를 때도 구분할 것이 있다. 1×1 합성곱의 채널 변환은 모델에 필요한 연산이고, dW도 가중치를 학습하려면 필요하다. 특정 cuDNN 구현을 피하는 것과 모델에서 연산을 없애는 것은 다른 변경이다. FP32, 다른 레이아웃, 행렬곱 표현 등으로 실행 경로를 바꿀 수는 있지만, 그때마다 커널 선택과 정확도·성능을 다시 검증해야 한다.

## TF32 후속 실험: 같은 cuDNN에서도 다른 조건은 실패했다

cuDNN 9.27로 BF16 학습을 마친 뒤에도 장애 서버의 오류는 끝나지 않았다. 이번에는 합성곱 shape 네 가지, 자료형 세 가지(BF16·FP16·TF32), 레이아웃 두 가지를 돌아가며 실행하는 재현 sweep에서 오류가 났다.

### TF32는 무엇을 바꾸는가

TF32는 FP32 텐서를 그대로 저장한 채 Tensor Core 곱셈의 입력 정밀도만 줄이는 방식이다. 지수 범위는 FP32와 같고 가수는 10bit 수준으로 줄여 곱하며, 누산은 FP32로 한다. PyTorch에서는 `torch.backends.cuda.matmul.allow_tf32`와 `torch.backends.cudnn.allow_tf32`로 켜고 끈다. 속도를 얻는 대신 수치 오차를 감수하는 설정이라, 쓰려면 정확도를 검증해야 한다.[^pytorch-tf32]

정밀도가 낮아진다고 잘못된 주소가 생기지는 않는다. 다만 TF32를 허용하면 cuDNN이 다른 커널과 자원 배치를 고른다. 다음은 앞의 커널 비교에 쓴 것과 같은 1×1 합성곱을 FP32로 저장하고 TF32를 허용한 조건이다.

| 항목 | 값 |
|---|---|
| 연산 | 앞의 최소 연산과 같은 1×1 합성곱(batch 4096) |
| 설정 | FP32 저장, TF32 허용, channels-last, `cudnn.benchmark=False` |
| 버전 | PyTorch 2.10.0+cu128, cuDNN 9.27.0.42 |

이 조건에서 cuDNN 9.27이 고른 커널은 다음과 같다. forward 커널은 thread당 레지스터 224개와 shared memory 80KiB를 쓰며, 이 80KiB는 앞의 shared memory 식으로 계산한 값과 정확히 맞는다.

```text
forward  cutlass_80_tensorop_s1688gemm_128x128_16x5_tn_align4
dX       cutlass_80_tensorop_s1688gemm_64x256_16x4_nn_align4
dW       wgrad_alg0_engine_NHWC<float,128,5,5,3,3,3,false,512>
```

### 실패 경계 찾기

sweep에 앞에서 소개한 연산별 checkpoint를 넣고 Nsight Systems로 기록했다. BF16·FP16 조건이 forward/backward 515쌍을 먼저 실행했고, 이어진 TF32 조건에서 forward와 backward가 13번씩 정상 완료됐다. 14번째 forward의 기록은 다음과 같다.

```text
13번째 forward   → GPU 실행·완료 기록 있음
13번째 backward  → dX / dW 완료 기록 있음
14번째 forward   연산 전 동기화 → 성공
                 launch → API 반환 0
                 연산 후 동기화 → illegal memory access
                 GPU 실행 기록 → 없음
같은 프로세스:   Xid 31 (GPC2, client T1_13, 주소 0x0, FAULT_PDE, VIRT_READ)
```

BF16 학습의 실패와 같은 GPC, 같은 client, 같은 주소 형태의 MMU fault다. 이번에는 dW가 아닌 forward 경계에서 드러났다. 연산 전후 동기화로 실패가 드러난 연산은 좁힐 수 있지만, 앞선 연산이 만든 데이터가 올바른지, 실패한 명령이 무엇인지, SM 안의 어느 회로가 문제인지는 알 수 없다. 이 기록도 이전 Xid가 남아 있던 부팅에서 수집했다.

![Nsight Systems 타임라인. 실패한 TF32 forward의 NVTX 구간이 청록색으로 강조돼 있다](assets/gpu-sm-warp-nsight-tf32-timeline.png)

![Nsight Systems의 NVTX 범위 표. 직전 backward 행이 선택돼 있고 그 RangeId는 1057이다](assets/gpu-sm-warp-nsight-tf32-ranges.png)

*그림 5. 장애 서버에서 기록한 TF32 sweep의 실패 직전 구간(Nsight Systems). 같은 화면에서 필요한 부분만 잘랐다. 위 타임라인은 가운데 구간을 생략했고(이중선), 아래 표는 Start, Duration, Name, TID, RangeId 열만 골랐다. `SWEEP_CP_1057`은 계측 코드가 연산마다 붙인 일련번호로, 본문의 14번째 TF32 forward다. 청록색 구간이 이 forward의 NVTX 구간(13.244ms)이고, 그 안에 `cudaDeviceSynchronize` 호출이 보인다. backward는 `pt_autograd_0` thread에서, forward는 `python` thread에서 실행된다(표의 TID). 표에서 파랗게 선택된 행은 직전 backward(`SWEEP_CP_1056`)인데, 이 행의 RangeId가 1057이라 찾는 checkpoint로 착각하기 쉽다. 이 화면에는 GPU 커널 행이 표시되지 않으므로, GPU 실행 기록이 없다는 판단은 CUDA API 기록과 커널 로그를 대조해 내렸다.*

Nsight 기록을 읽을 때 두 가지를 조심했다.

- **NVTX 표의 `RangeId`는 애플리케이션이 붙인 번호가 아니다.** checkpoint 번호는 NVTX 이름에 넣은 값으로 찾아야 한다. RangeId는 Nsight가 붙이는 별도 식별자인데, 이번에는 직전 backward 행의 RangeId가 마침 찾던 checkpoint 번호와 같아 헷갈리기 쉬웠다(그림 5의 아래 표).
- **기록이 없다고 실행되지 않은 것은 아니다.** report에는 타임스탬프를 얻지 못한 CUPTI 이벤트 하나를 버렸다는 진단이 남아 있었다. 마지막 동기화의 반환 값 필드도 애플리케이션의 오류 기록과 맞지 않아서, 한 필드만 믿지 않고 완료 표시, 프로세스 오류, 커널 로그를 함께 대조했다.

### 드라이버를 올리고 새로 부팅해도 실패했다

이전 오류의 잔여 영향인지 가리기 위해, OS 커널을 업데이트하고 드라이버를 615.71.09로 올린 뒤 새로 부팅했다. 드라이버 버전은 설치된 패키지가 아닌 실제로 로드된 커널 모듈로 확인했고, 첫 sweep을 시작할 때 이전 Xid는 하나도 없었다. 그런데도 BF16·FP16 조건을 마친 뒤 TF32 조건에서 Xid 31과 illegal memory access가 났다.

드라이버 업데이트만으로는 해결되지 않았고, 9.27의 실패를 모두 이전 오류의 잔여 영향으로 돌릴 수도 없다는 뜻이다. 이 실행에는 연산별 Nsight 기록이 없어서 forward·dX·dW 가운데 어디서 실패했는지는 확정하지 않았다. 같은 부팅에서 이어 실패한 여덟 번의 실행은 이미 오류가 난 GPU에서 돌았으므로 독립된 반복으로 세지 않았다.

## NVTX 구간은 GPU 실행 시간이 아니다

Nsight Systems 화면에서 긴 막대를 찾았다고 병목이나 장애 원인을 찾은 것은 아니다. NVTX는 코드가 표시한 CPU 쪽 구간이다. 그 안에는 준비 작업, 라이브러리 호출, 동기화, 계측 비용이 함께 들어간다. GPU 시간은 launch correlation으로 연결된 GPU 실행 기록에서 읽어야 한다.[^nsys]

| 실행 | NVTX 구간 | GPU 커널 | 해석 |
|---|---:|---:|---|
| 장애 서버, 첫 TF32 forward | 58.255ms | 0.221ms | 첫 호출의 준비·로딩 비용 포함. 연산은 완료 |
| 같은 실행, 두 번째 TF32 forward | 3.133ms | 0.212ms | profiler stop 호출 약 2.8ms 포함 |
| 비교 서버, 첫 TF32 forward | 58.393ms | 0.215ms | 비교 서버에서도 같은 첫 호출 비용 |
| 장애 서버, 실패한 14번째 forward | 13.244ms | 기록 없음 | 동기화에서 오류(그림 5). GPU 실행 시간은 알 수 없음 |

첫 forward에서는 launch 호출이 시작되기까지 56.102ms가 걸렸다. 이 사이에 `cuLibraryLoadData` 4번(합계 24.658ms)과 `cuKernelGetFunction`(4.113ms)이 기록됐다. 처음 쓰는 커널의 코드를 불러오는 비용이다. 나머지 CPU 시간은 특정 작업으로 분류하지 못했다. 같은 구간에 JIT 컴파일 기록은 없었으므로, 58ms 전체를 "JIT 컴파일 시간"이라고 부를 수도 없다.

완료 시점까지 NVTX 구간에 넣으려면 동기화를 범위 안에 둔다.

```python
torch.cuda.synchronize()
with torch.cuda.nvtx.range(label):
    out = func(*args, **kwargs)
    print("api_returned", flush=True)
    torch.cuda.synchronize()
    print("completed", flush=True)
```

이렇게 해도 NVTX 구간의 길이는 CPU 쪽에서 기다린 시간이므로, 장비 간 성능 비교에는 쓰지 않는다.

계측 옵션도 오해하기 쉽다. `--flush-on-cudaprofilerstop=true`는 profiler stop이 호출될 때 trace 버퍼를 비우도록 요청하는 옵션이다. 장애 중에 완료되지 않은 GPU 실행 기록까지 보존된다는 보장은 없다. 또 Nsight의 상대 시각, 프로세스의 monotonic 시각, 커널 로그의 수신 시각은 기준과 보고 지연이 서로 달라서, 그 차이를 GPU 시계 오차로 읽으면 안 된다.

## 학습 코드 없이 실행 경로 재구성하기

TF32 사례는 모델, 데이터셋, optimizer 없이 1×1 합성곱 하나와 그 dX·dW로 줄일 수 있다. 다른 장비와 비교하려면 이런 독립 재현 코드가 필요하다. 두 가지를 만들었다.

- **Python 재현**: PyTorch로 같은 연산을 실행하면서 연산 전후 동기화, NVTX, 환경과 오류를 기록한다. 원래 sweep은 시간 기준으로 반복해 실행마다 반복 횟수가 달랐기 때문에, 실패 직전까지의 반복 횟수를 재구성하는 옵션도 뒀다.
- **Native 재현**: PyTorch 없이 CUDA Runtime과 cuDNN Backend API로 같은 연산을 실행하는 CUDA C++ 프로그램이다. GEMM을 직접 짜는 대신 cuDNN의 device 커널을 그대로 호출하므로, 비교하려는 실행 경로가 유지된다.

Native 코드의 흐름은 앞에서 본 cuDNN Graph API의 개념과 그대로 대응한다.[^cudnn-graph]

```text
tensor descriptor: shape, stride, FP32, alignment
  → convolution operation graph
  → heuristic engine configuration + 수치 특성(numerical note) 필터
  → execution plan
  → variant pack: X / W / Y 포인터 + workspace
  → cudnnBackendExecute
  → cudaDeviceSynchronize
```

두 언어에서 같은 seed를 써도 난수열은 다르다. 그래서 입력을 파일로 공유하고 hash로 같은 입력인지 확인했다. shape, 물리적인 NHWC 저장 순서, 자료형, TF32 허용 여부, 실제로 선택된 커널도 함께 맞췄다.

비교 서버(RTX 5090, 드라이버 580.159.03, PyTorch 2.10.0+cu128, cuDNN 9.27.0.42)에서 검증한 결과는 다음과 같다.

| 검증 | 결과 |
|---|---|
| Python 재현 | BF16·FP16 선행 515쌍과 TF32 forward/backward 100쌍 완료 |
| Native 재현 | 같은 입력으로 TF32 forward·dX·dW 각 100회 완료 |
| 커널 경로 | 세 커널의 이름, grid·block, 레지스터, shared memory가 장애 서버의 실패 직전 성공 실행과 일치 |
| Y·dX 비교 | 전체 원소의 최대 절대 차이 0 |
| dW 비교 | 전체 원소의 최대 절대 차이 0.0029, 상대 L2 오차 약 6.7e-7 |
| CPU 검산 | Y·dX·dW에서 32개씩 표본을 뽑아 FP64로 검산. 상대 L2 오차는 Y·dX 약 3.3e-4, dW 1e-6 이하 |
| TF32 비활성 대조 | forward·dX는 engine 58·63에서 engine 1로 바뀌고, dW는 engine 20 유지 |

dW는 비결정적 실행으로 표시된 경로라 비트 단위 일치를 요구하지 않았다. 실행이 끝났는지와 값이 맞는지는 따로 확인해야 한다.

**이 코드로 장애 서버의 실패를 재현하지는 못했다.** 지금은 정상 장비에서 연산, 수치, 실행 경로를 검증한 단계다. 실패한 14번째 forward는 GPU 실행 기록이 없어 실패 직전의 성공 실행과 비교했고, 당시의 입력값, 메모리 할당 주소, GPU 내부 상태는 보존되지 않았으므로 같은 시점의 실패를 보장하지도 않는다. 그래도 학습 데이터 없이 실행할 수 있어서, 장비를 바꿔 가며 비교하는 기준으로 쓸 수 있다.

## 장비 교체 후 같은 재현 코드로 다시 확인하기

이후 장비를 교체했다. GPU가 바뀐 것은 UUID로 확인했지만, 다른 교체 부품의 serial까지 대조하지는 않았다. 교체 후 같은 재현 코드를 두 번 실행했다.

### 계측 없이 원래 sweep 실행

Python 3.13.15, PyTorch 2.10.0+cu128, CUDA runtime 12.8, cuDNN 9.27.0.42, 드라이버 615.71.09 환경에서 원래 sweep을 실행했다. shape 네 가지 × BF16·FP16·TF32 × channels-last·contiguous의 24개 조건을 한 프로세스에서 네 번 돌아, 96개 조건 실행과 forward/backward 793,455회 반복을 마쳤다. 과거 실패와 연결된 TF32 channels-last 조건도 모두 5,431회 반복됐다. CUDA 예외나 멈춤 없이 종료 코드 0으로 끝났다.

### Nsight로 같은 연산 비교

같은 Nsight Systems 버전과 같은 NVTX 계측 코드로 다시 기록했다. 재현 코드와 계측 wrapper의 SHA-256, Python 패키지 목록은 이전과 같았고, 드라이버만 달랐다. 96개 조건 실행, forward/backward 16,676회, checkpoint 33,352개가 모두 완료됐다.

비교할 연산은 checkpoint 번호가 아니라 입력 조건(shape, stride, FP32, channels-last, TF32 허용)으로 찾았다. 시간 기준 sweep에서는 앞선 조건의 반복 횟수가 달라지면 같은 연산의 번호도 바뀌기 때문이다.

| 관측 | 교체 전 장애 서버 | 비교 서버 | 교체 후 |
|---|---|---|---|
| 기록 당시 드라이버 | 580.159.03 | 580.159.03 | 615.71.09 |
| 해당 TF32 forward | 13회 완료 후 14번째에서 실패 | 653회 완료 | 597회 완료 |
| 14번째 forward의 GPU 실행 기록 | 없음 | 완료 1건 | 완료 1건 |
| 성공한 forward의 GPU 시간 중앙값 | 0.211ms (13회) | 0.209ms (653회) | 0.217ms (597회) |

교체 후 597회에는 모두 완료 표시와, launch correlation으로 연결된 GPU 실행 기록이 있었다. forward 커널의 이름(`cutlass_80_tensorop_s1688gemm_128x128_16x5_tn_align4`)과 launch 구성(block당 thread 128개, 레지스터 224개, dynamic shared memory 80KiB)은 교체 전 실패 직전의 성공 실행, 비교 서버의 성공 실행과 같았다. 이어지는 backward의 dX·dW 커널도 같았다. 표의 중앙값은 표본 수, 드라이버, 초기 상태가 서로 다른 실행에서 나온 값이라, 성능 개선이나 회귀를 판정하는 데는 쓸 수 없다.

### 이 결과의 의미와 한계

**교체 후에는 기존 TF32 실패 조건이 통과하고, 같은 커널이 끝까지 실행된다.** 여기까지가 확인한 사실이고, 한계는 다음과 같다.

- **드라이버도 함께 바뀌었다.** 두 Nsight 기록은 드라이버가 580.159.03과 615.71.09로 다르다. 그래도 교체 전 장비는 615.71.09로 새로 부팅한 첫 실행에서도 실패했으므로, 이번 통과를 드라이버 업데이트만으로 설명하기는 어렵다. 그 실패 실행은 연산별 Nsight 기록이 없어서 어느 연산에서 실패했는지는 모른다.
- **실패한 커널은 직접 보지 못했다.** 실패한 14번째 forward의 GPU 실행 기록은 없었다. 이름과 launch 구성이 같다고 SASS나 실행된 물리 SM까지 같다고 볼 수도 없다.
- **새 Xid 유무는 확인하지 못했다.** 실행 계정에 커널 로그 권한이 없었다. 읽을 수 있었던 GPU와 root port의 AER 카운터는 0을 유지했다.
- **초기 상태와 입력이 같지 않다.** 교체 후의 두 시험은 같은 부팅에서 이어서 했고, 입력 seed를 고정하지 않아 데이터 값도 이전과 다르다.
- **계측 실행은 실제 부하와 다르다.** 반복마다 동기화와 profiler flush를 했으므로 계측 없는 실행과 부하가 다르다. 장시간 실제 학습의 안정성이나 수치 정확도는 확인하지 않았다.

## 교체와 업데이트의 시간 순서는 인과관계가 아니다

장애 전후로 여러 변경이 겹쳤다. 시간 순서만 보면 그럴듯한 원인이 여럿 보인다. 교체 시점은 기억에 기대기보다 새 GPU UUID가 처음 나타난 시점으로 확인하는 편이 정확했다.

| 시점 | 기록 | 해석 |
|---|---|---|
| 첫 교체 전 | PCIe AER와 Xid 79. SM 예외 기록 없음 | 교체 후 SM·MMU 오류와 같은 원인인지 확인하지 못함 |
| 첫 교체 | GPU 교체, BIOS 업데이트 | 이후 며칠간 오류 기록이 없다고 같은 작업이 통과했다는 뜻은 아님 |
| OS 커널 업데이트 | 새 커널로 부팅하고 약 11시간 반 뒤 첫 MMU fault | 같은 기간 모델과 학습 코드도 바뀌어 커널의 영향을 분리할 수 없음 |
| 이후 | 첫 SM 예외 뒤 로그 증가 | 그사이 실행 중인 커널은 바뀌지 않아, 빈도 증가를 커널 변경으로 설명할 수 없음 |
| 이후 | OS 커널과 드라이버(R615)를 다시 올려 부팅. 오류 지속 | 후속 버전 적용만으로 해결되지 않음 |
| 두 번째 교체 | 장비 교체 후 TF32 재현 조건 통과 | 앞 절 참고 |

두 커널 버전 사이의 변경 내역을 검토한 범위에서는 이번 GPU 오류에 직접 대응하는 메모리 관리·PCIe·IOMMU 수정 후보를 찾지 못했다. 이것만으로 커널 회귀를 배제할 수는 없다. 같은 카드, 코드, 입력, 드라이버로 두 커널을 새로 부팅해 비교해야 판단할 수 있다.

첫 교체 무렵에는 BIOS도 바뀌었다. DMI에 나오는 날짜는 펌웨어가 배포된 날짜라서, 언제 설치했는지는 알 수 없다.

## 이번 사례에서 확인한 것과 확인하지 못한 것

9.27 릴리스 노트에도 illegal-address 관련 수정이 있다. runtime compilation으로 만든 커널 코드가 CUDA Graph에서 아직 쓰일 수 있는데도 너무 일찍 unload되던 문제다. 하지만 이번 비교는 모두 eager 실행이었고 CUDA Graph를 쓰지 않았다. 오류 이름이 같다는 이유만으로 같은 버그가 고쳐졌다고 볼 근거는 없다. 9.10과 9.27 사이의 다른 변경 사항(9.11의 convolution heuristics 정렬 조건 수정, 9.21의 Blackwell용 TensorIR GEMM fusion 경로 등)도 이번 선택 차이와 연결할 증거는 찾지 못했다.[^cudnn-release]

새 환경에서 학습을 끝까지 마친 뒤에는 같은 평가 데이터로 정확도도 비교했다. 뚜렷한 차이는 없었지만, 허용 오차를 미리 정하지 않았고 반복 학습 사이의 변동을 반영하지 않았으므로 두 환경이 동등하다는 증명은 아니다. 커널이 바뀌면 연산 순서와 reduction 방식이 바뀌므로, seed가 같아도 학습 궤적은 달라질 수 있다.

정리하면 다음과 같다.

| 주장 | 현재 증거 수준 |
|---|---|
| cuDNN 9.27 환경에서 BF16 학습을 완료할 수 있다 | 확인. 재부팅 직후, 첫 Xid 이전의 실제 학습 1회와 평가 |
| cuDNN만 바꿔도 선택되는 커널이 달라진다 | 확인. 일부 선택은 9.26에서도 같고, 관측한 8개 커널의 SASS도 9.26·9.27이 같음 |
| BF16 학습의 실패 후보는 특정 1×1 합성곱의 dW 경로다 | 가장 유력한 조사 범위. 실패 커널의 GPU 기록과 오류 명령은 미확보 |
| 레지스터 spill이나 낮은 occupancy가 원인이다 | 맞지 않음. 측정한 커널에 spill이 없고 occupancy 변화도 shape마다 다름 |
| 이 선택 변화는 9.27에서 처음 생겼다 | 맞지 않음. 9.26에서도 같은 커널과 SASS |
| 9.27이면 모든 정밀도에서 정상이다 | 맞지 않음. TF32 조건에서 실패했고, 드라이버 R615 새 부팅의 첫 실행에서도 실패 |
| 교체 후 기존 재현 조건이 통과한다 | 확인. 계측 없이, Nsight 계측으로 각각 96개 조건 완료. 실제 학습과 수치 검증은 별도 |
| 교체 후 같은 TF32 forward 커널이 완료된다 | 확인. 597회, 이름과 launch 구성 일치. 실패한 커널의 기록과 SASS 일치는 미확인 |
| Native 재현 코드가 같은 장애를 재현한다 | 아직 미확인. 정상 장비에서 연산, 수치, 커널 경로만 검증 |
| OS 커널 업데이트가 근본 원인이다 | 시간 순서만 확인. 같은 기간에 workload도 바뀌었고 교차 비교를 하지 않음 |
| 특정 SM·L1·메인보드의 물리적 결함이 확정됐다 | 미확정. 오류 위치, 명령, 포인터 생성 경로, 부품 원인을 구분해야 함 |

BF16 학습 성공은 그 학습 설정을, 교체 후 TF32 sweep 통과는 그 재현 조건을 검증한 결과이므로 따로 기록해 둬야 한다. 교체 후 실제 학습의 장시간 안정성과 정확도는 별도로 확인해야 하고, TF32를 끄는 우회가 필요한지도 이 구분에 맞춰 판단해야 한다.

## 비슷한 오류를 만났을 때 제안하는 접근

이번 조사를 돌아보며, 처음부터 이렇게 했다면 더 빨리 좁혔겠다고 생각한 순서를 정리했다. 비슷한 증상을 만났을 때 참고할 수 있다.

### 1. 설치된 버전이 아니라 로딩된 라이브러리를 기록한다

PyTorch wheel은 cuDNN을 의존성으로 함께 설치하고, 환경에 따라 다른 경로의 라이브러리가 로딩될 수도 있다. `pip list`에 보이는 버전보다 프로세스가 실제로 로딩한 버전이 중요하다.

```python
import torch

print(torch.__version__, torch.version.cuda, torch.backends.cudnn.version())

# 합성곱을 한 번 실행한 뒤 확인하면 실제로 쓰인 하위 라이브러리까지 보인다.
with open("/proc/self/maps") as f:
    print(sorted({line.split()[-1] for line in f if "libcudnn" in line}))
```

`/proc/self/maps`에는 CPU 쪽 프로세스에 매핑된 공유 라이브러리가 나온다. GPU page table과는 관계가 없다. 여기에 드라이버 버전, GPU UUID, boot ID(`/proc/sys/kernel/random/boot_id`)를 함께 남겨 두면 나중에 실행 조건을 되짚기 쉽다.

### 2. 동기화로 위치를 좁히고, 실행마다 첫 오류만 센다

`CUDA_LAUNCH_BLOCKING=1`로 오류가 난 연산을 먼저 찾는다. 그리고 실행 하나에서 처음 난 오류만 그 실행의 결과로 기록한다. 그 뒤에 이어지는 오류는 앞선 오류의 여파일 수 있으므로 별개의 사건으로 세지 않는다. 실패하는 실행의 trace까지 남기려면 앞에서 소개한 연산별 checkpoint와 `nsys stop` 종료 순서를 함께 쓴다.

### 3. 실행 경로를 하나씩 바꿔 본다

같은 모델에서 실행 경로만 바꾸는 실험은 비용이 적게 들고 얻는 정보가 많다. 한 번에 하나만 바꾼다.

| 바꾸는 것 | 방법 | 달라지는 것 |
|---|---|---|
| 메모리 레이아웃 | `channels_last` 끄기 | stride와 선택되는 커널 |
| cuDNN 사용 여부 | `torch.backends.cudnn.enabled = False` | cuDNN 대신 PyTorch 자체 구현 사용 |
| 커널 선택 방식 | `torch.backends.cudnn.benchmark` 전환 | heuristic 추천 후보 ↔ 실측 최속 후보 |
| cuDNN 버전 | 별도 가상환경에서 `nvidia-cudnn-cu12`만 교체 | engine과 커널 구성 |
| 자료형 | BF16 ↔ FP32 | Tensor Core 경로와 타일 구성 |
| TF32 허용 여부 | `torch.backends.cudnn.allow_tf32` 전환 | Tensor Core 사용 여부와 engine 선택 |

실패가 특정 경로를 따라 움직이면 소프트웨어나 실행 조건 쪽 가설이 힘을 얻는다. 어떤 경로를 택해도 같은 위치에서 실패하면 하드웨어 가설이 강해진다.

### 4. 실패와 통과를 같은 shape의 커널 단위로 비교한다

앞에서 소개한 cuDNN 로그와 프로파일러 trace를 실패한 실행과 통과한 실행 모두에서 남긴다. 그리고 같은 shape·stride·자료형의 연산끼리 실행 계획과 커널 이름, launch 정보를 맞대어 본다. 최소 재현 코드에서 본 커널이 실제 학습에서도 쓰이는지 반드시 확인한다. 커널 단위로 더 깊이 비교하려면 Nsight Compute로 launch 구성, occupancy, local memory 트래픽, SASS를 함께 남긴다. 버전 간 SASS를 비교할 때는 PC와 branch 대상을 상대 위치로 정규화해야 의미 있는 비교가 된다.

### 5. 최초의 잘못된 접근을 붙잡는다

근본 원인에 가장 가까운 정보는 처음 잘못된 접근이 일어난 순간의 실행 문맥이다. 두 가지 도구를 함께 쓸 수 있다.

**Compute Sanitizer**는 커널을 계측해 잘못된 접근을 커널 이름, thread, 주소와 함께 보고한다.

```bash
compute-sanitizer --tool memcheck python repro.py
```

도구마다 검사 범위가 다르다. `memcheck`는 범위·정렬 오류와 하드웨어 예외를, `racecheck`는 shared memory의 데이터 hazard를, `initcheck`는 초기화되지 않은 메모리 읽기를, `synccheck`는 동기화 primitive의 잘못된 사용을 본다. `racecheck`를 통과했다고 global memory race까지 없다고 볼 수는 없다. 또 계측 때문에 실행이 크게 느려지고 타이밍이 바뀌므로, 도구를 붙인 실행에서 재현되지 않았다고 원래 실행이 정상인 것도 아니다. 실제로 이번 조사에서 수집한 `memcheck` 기록에는 정확한 load·store 위치 없이 API 수준의 illegal-address 오류만 남았다.[^sanitizer]

**GPU core dump**는 계측 없이 원래 속도로 실행하다가, 예외가 난 순간의 GPU 상태를 파일로 남긴다. 타이밍에 민감해 sanitizer를 붙이면 재현되지 않는 오류에 특히 유용하다.

```bash
export CUDA_ENABLE_COREDUMP_ON_EXCEPTION=1
export CUDA_COREDUMP_FILE=gpu_core_%p.nvcudmp
python repro.py

cuda-gdb
(cuda-gdb) target cudacore gpu_core_<pid>.nvcudmp
```

core dump를 열면 예외가 난 커널, 명령 위치, block·thread 좌표, 레지스터 값을 볼 수 있다. cuDNN처럼 소스가 공개되지 않은 라이브러리 커널이라도 어느 커널의 어느 명령에서 멈췄는지는 남는다. core dump에도 제약이 있다. 켜는 것만으로 성능에 영향을 줄 수 있고, 모든 오류에서 dump가 생기거나 최초 원인을 복구할 수 있다고 보장되지도 않는다. 사용하는 CUDA 버전이 지원하는 범위를 확인하고, Nsight나 sanitizer와는 따로 실행한다.[^cuda-gdb-coredump]

최소 재현은 trace로 좁힌 연산을 대상으로 만들고, 떼어 낸 뒤에도 같은 실행 계획과 커널이 선택되는지 확인한다. 앞에서 본 것처럼 Python과 native 코드를 함께 두고 입력을 파일로 공유하면, 학습 데이터 없이도 실행 경로와 수치를 대조할 수 있다. 이렇게 모은 정보는 그대로 라이브러리 개발사에 보고할 수 있는 자료가 된다. 정확한 shape·stride·자료형을 담은 최소 재현 코드, 버전 정보, cuDNN 로그, core dump를 함께 전달하면 내부 구현을 아는 쪽에서 원인을 훨씬 빨리 좁힐 수 있다.

### 6. 독립 시험을 설계한다

버전을 비교할 때는 시험마다 GPU를 reset하거나 재부팅해 초기 상태를 맞춘다. 시험 직전의 boot ID와 기존 Xid 유무를 기록하고, 이미 오류가 난 GPU에서는 다음 시험을 시작하지 않는다. 비교할 환경은 A-B-B-A처럼 순서를 번갈아 배치해, 한 환경이 늘 오류 직후의 GPU를 물려받지 않게 한다. 통과 기준(몇 스텝 동안 새 Xid 없음 등)도 시험 전에 정해 둔다.

```text
복구가 필요한 오류 확인 → 복구 지침에 맞는 초기화
  → boot ID, GPU UUID, 실제 로딩된 드라이버·cuDNN, 기존 Xid 기록
  → 비교할 조건 하나 실행 → 최초 오류 또는 완료 시 종료
  → trace, 출력, 새 Xid 보존 → 다음 조건의 기준 상태 확인
```

이 절차는 심각한 fault가 난 뒤 그 영향이 다음 비교 조건으로 넘어가지 않게 하려는 것이다. 평소의 GPU 시험마다 재부팅할 필요는 없다.

### 7. 하드웨어 분리는 교차 장착으로 한다

소프트웨어와 환경을 그대로 두고 GPU와 호스트를 교차 장착하면, 실패가 카드를 따라가는지 호스트를 따라가는지 직접 확인할 수 있다. FurMark나 OCCT 같은 부하 시험은 전력과 발열 조건은 잘 만들지만, 문제가 된 커널의 주소 계산·정렬·동기화 조건은 실행하지 않는다. 부하 시험을 통과했다고 특정 커널의 정상 실행까지 보장되지는 않는다.

### 8. 운영에서는 우회와 원인 규명을 따로 관리한다

원인을 모르더라도 통과하는 환경을 찾았다면 우선 그 환경으로 학습을 이어 갈 수 있다. 이때 몇 가지를 함께 챙기는 것이 좋다.

- **버전 고정은 최상위 프로젝트에서 한다.** PyTorch가 선언한 cuDNN 의존성과 다른 버전을 쓰려면 패키지 관리자의 override가 필요하다. uv의 `override-dependencies`는 라이브러리 저장소에 두면 그 라이브러리를 설치하는 프로젝트로 전파되지 않으므로, 실제 학습 프로젝트의 최상위 설정에 둬야 한다.[^uv-override]
- **실행 시점에 확인한다.** 학습 시작 시 로딩된 cuDNN 버전을 검사해, 의도와 다르면 바로 멈추게 한다.

  ```python
  EXPECTED_CUDNN = 92700  # cuDNN 9.27.0 (major*10000 + minor*100 + patch)
  assert torch.backends.cudnn.version() == EXPECTED_CUDNN, torch.backends.cudnn.version()
  ```

- **되돌릴 스위치를 남겨 둔다.** `channels_last`처럼 문제 경로를 피하는 설정을 플래그로 둬서, 새 버전에서 재발하면 바로 우회할 수 있게 한다.
- **첫 Xid에서 멈춘다.** 커널 로그의 Xid를 감시해, 오류가 난 GPU에는 reset 전까지 새 작업을 배치하지 않는다. 오류 이후의 결과는 실패든 통과든 해석하기 어렵다.
- **정확도는 허용 오차를 먼저 정하고 비교한다.** 라이브러리를 바꾸면 수치 경로가 바뀐다. 기존 환경 대비 허용할 정확도 차이를 미리 정하고, 여러 seed로 반복해 비교한다.

### 증상별로 먼저 확인할 것

| 증상 | 먼저 확인할 것 |
|---|---|
| Python 스택이 엉뚱한 곳을 가리킨다 | `CUDA_LAUNCH_BLOCKING=1`로 재실행 |
| Nsight에서 NVTX 막대가 길다 | 연결된 GPU 실행 기록의 시간, 첫 호출의 코드 로딩 비용 |
| 실패한 실행의 Nsight trace가 비어 있다 | 연산별 동기화와 profiler stop/start, 종료 전 `nsys stop` |
| 레지스터가 많아 spill이 의심된다 | Nsight Compute의 local memory sector, SASS의 `LDL`·`STL` 명령 |
| SM Warp Exception(Xid 13)이 반복된다 | 실패한 커널 이름과 shape, core dump, 실행 경로를 바꿨을 때 실패가 움직이는지 |
| MMU fault(Xid 31), 주소 `0x0` | 포인터가 만들어진 경로, workspace와 텐서의 수명 |
| Xid 109 이후 실패가 이어진다 | GPU reset이나 재부팅 후 재시험, boot ID 기록 |
| 버전을 올렸더니 통과한다 | 실제 로딩된 버전, 선택된 커널의 변화, 다른 정밀도·조건에서도 통과하는지, 정확도 비교 |
| 같은 SM 좌표가 반복된다 | 독립 시험 횟수, 경로 변경 시 위치 유지 여부, 교차 장착 결과 |

## 맺으며

같은 SM에서 오류가 반복되면 조사를 시작할 이유로는 충분하다. 하지만 로그의 좌표로 알 수 있는 것은 잘못된 접근을 실행한 위치까지다. 그 주소를 만든 코드, 그 코드를 고른 라이브러리, 실행 직전의 GPU 상태는 따로 확인해야 한다.

이번 사례에서는 세 가지 결과를 함께 설명해야 했다. cuDNN을 바꾸자 BF16 학습이 끝까지 진행됐고, 같은 cuDNN에서도 TF32 조건은 다시 실패했으며, 장비를 교체하자 그 TF32 조건이 통과했다. 그러려면 성공과 실패마다 입력, 정밀도, 실행 경로, 초기 상태를 붙여 기록해야 했다. 그러다 보니 "어느 버전이 정상인가"라는 질문도 "어떤 조건에서 무엇을 확인했는가"로 구체화됐다.

제목의 질문에 답하자면, 이번 사례에서는 장비를 교체한 뒤 실패 조건이 사라졌으므로 교체한 장비 쪽에 원인이 있었을 가능성이 가장 크다. 다만 그렇게 판단한 근거는 SM 좌표의 반복보다, 실행 경로를 바꿔 가며 실패가 어떻게 달라지는지 보고, 깨끗한 초기 상태에서 다시 확인하고, 같은 재현 코드로 교체 전후를 비교한 결과였다. 어느 부품의 어떤 결함인지는 아직 확정하지 못했다.

## 참고 자료

[^blackwell]: [NVIDIA, RTX Blackwell GPU 아키텍처 백서](https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf)
[^simt]: [CUDA Programming Guide, SIMT 실행과 스케줄링](https://docs.nvidia.com/cuda/cuda-programming-guide/03-advanced/advanced-kernel-programming.html#hardware-implementation)
[^local-memory]: [CUDA Programming Guide, local memory](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/writing-cuda-kernels.html#local-memory)
[^resident-blocks]: [CUDA Programming Guide, SM 자원과 상주 block](https://docs.nvidia.com/cuda/cuda-programming-guide/03-advanced/advanced-kernel-programming.html#hardware-multithreading)
[^bank-conflict]: [CUDA Programming Guide, shared memory 접근 패턴과 bank](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/writing-cuda-kernels.html#shared-memory-access-patterns)
[^channels-last]: [PyTorch Tutorials, channels-last 메모리 형식](https://docs.pytorch.org/tutorials/intermediate/memory_format_tutorial.html)
[^coalescing]: [CUDA C++ Best Practices Guide, global memory coalescing](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#coalesced-access-to-global-memory)
[^cudnn-graph]: [cuDNN Developer Guide, Graph API의 engine과 execution plan](https://docs.nvidia.com/cudnn/latest/developer/graph-api/)
[^pytorch-conv]: [PyTorch 2.10 소스, cuDNN convolution 구현(`Conv_v8.cpp`)](https://github.com/pytorch/pytorch/blob/v2.10.0/aten/src/ATen/native/cudnn/Conv_v8.cpp)
[^cudnn-logging]: [cuDNN 9.10.2 문서, API logging](https://docs.nvidia.com/deeplearning/cudnn/backend/v9.10.2/reference/troubleshooting.html)
[^cudnn-frontend]: [NVIDIA cuDNN Frontend 저장소, logging 설정](https://github.com/NVIDIA/cudnn-frontend)
[^ncu-cli]: [Nsight Compute CLI 문서](https://docs.nvidia.com/nsight-compute/NsightComputeCli/index.html)
[^ncu-guide]: [Nsight Compute Profiling Guide, replay·캐시·occupancy·warp 상태](https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html)
[^binary-compat]: [CUDA C++ Programming Guide 12.9.2, binary compatibility](https://docs.nvidia.com/cuda/archive/12.9.2/cuda-c-programming-guide/index.html#binary-compatibility)
[^cudnn-knob]: [cuDNN 9.27 Graph API 문서, backend knob 정의](https://docs.nvidia.com/deeplearning/cudnn/backend/v9.27.0/api/cudnn-graph-library.html)
[^cuda-gdb-errors]: [CUDA-GDB 문서, GPU 예외 분류](https://docs.nvidia.com/cuda/cuda-gdb/index.html#gpu-error-reporting)
[^virtual-memory]: [CUDA C++ Programming Guide 12.8.1, 가상주소와 page table](https://docs.nvidia.com/cuda/archive/12.8.1/cuda-c-programming-guide/index.html#virtual-memory)
[^xid]: [NVIDIA Xid 오류 카탈로그](https://docs.nvidia.com/deploy/xid-errors/analyzing-xid-catalog.html)
[^smid]: [PTX ISA, `%smid` 특수 레지스터](https://docs.nvidia.com/cuda/parallel-thread-execution/index.html#special-registers-smid)
[^pytorch-async]: [PyTorch 2.10 문서, CUDA 비동기 실행](https://docs.pytorch.org/docs/2.10/notes/cuda.html#asynchronous-execution)
[^illegal-address]: [CUDA Runtime API, `cudaErrorIllegalAddress`](https://docs.nvidia.com/cuda/cuda-runtime-api/cuda_runtime_api/group__CUDART__TYPES.html)
[^nvidia-smi]: [nvidia-smi 문서, GPU Recovery Action](https://docs.nvidia.com/deploy/nvidia-smi/index.html)
[^nsys]: [Nsight Systems User Guide](https://docs.nvidia.com/nsight-systems/UserGuide/index.html)
[^pytorch-tf32]: [PyTorch 문서, Ampere 이후 장치의 TF32](https://docs.pytorch.org/docs/main/notes/cuda.html#tensorfloat-32-tf32-on-ampere-and-later-devices)
[^cudnn-release]: [cuDNN 9.27 릴리스 노트](https://docs.nvidia.com/deeplearning/cudnn/backend/v9.27.0/release-notes.html)
[^sanitizer]: [Compute Sanitizer 문서, 도구별 검사 범위](https://docs.nvidia.com/compute-sanitizer/ComputeSanitizer/index.html)
[^cuda-gdb-coredump]: [CUDA-GDB 문서, GPU core dump 지원과 제약](https://docs.nvidia.com/cuda/cuda-gdb/index.html#gpu-core-dump-support)
[^uv-override]: [uv 문서, `override-dependencies`](https://docs.astral.sh/uv/reference/settings/#override-dependencies)
