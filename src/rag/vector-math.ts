/**
 * 纯 TypeScript 向量运算
 * 不依赖任何第三方库，手写实现 Embedding 空间的基础运算
 */

/** 向量类型 -- 就是 number 数组 */
export type Vector = number[];

/**
 * 点积（Dot Product）
 * 两个向量对应元素相乘再求和
 * 公式：a · b = Σ(ai × bi)
 */
export function dotProduct(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

/**
 * 向量模长（L2 Norm / Euclidean Norm）
 * 公式：||a|| = √(Σ(ai²))
 */
export function magnitude(a: Vector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * a[i]!;
  }
  return Math.sqrt(sum);
}

/**
 * 余弦相似度（Cosine Similarity）
 * 衡量两个向量方向的相似程度，值域 [-1, 1]
 * 1 = 完全相同方向，0 = 正交（无关），-1 = 完全相反
 *
 * 公式：cos(θ) = (a · b) / (||a|| × ||b||)
 *
 * 这是 Embedding 搜索中最常用的相似度度量
 */
export function cosineSimilarity(a: Vector, b: Vector): number {
  const dot = dotProduct(a, b);
  const magA = magnitude(a);
  const magB = magnitude(b);

  if (magA === 0 || magB === 0) return 0;

  return dot / (magA * magB);
}

/**
 * 欧氏距离（Euclidean Distance）
 * 两个向量在空间中的直线距离，值域 [0, +∞)
 * 0 = 完全重合，越大越不相似
 *
 * 公式：d(a, b) = √(Σ((ai - bi)²))
 */
export function euclideanDistance(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * L2 归一化 -- 将向量缩放为单位向量（模长 = 1）
 * 归一化后 dot product = cosine similarity，计算更快
 */
export function normalize(a: Vector): Vector {
  const mag = magnitude(a);
  if (mag === 0) return a.map(() => 0);
  return a.map((x) => x / mag);
}

/**
 * 向量加法
 */
export function vectorAdd(a: Vector, b: Vector): Vector {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions mismatch: ${a.length} vs ${b.length}`);
  }
  return a.map((v, i) => v + b[i]!);
}

/**
 * 向量标量乘法
 */
export function vectorScale(a: Vector, scalar: number): Vector {
  return a.map((v) => v * scalar);
}

/**
 * 计算向量均值（用于聚合多个 embedding）
 */
export function vectorMean(vectors: Vector[]): Vector {
  if (vectors.length === 0) throw new Error('Cannot compute mean of empty array');
  const dim = vectors[0]!.length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i]! += v[i]!;
    }
  }
  return sum.map((s) => s / vectors.length);
}
