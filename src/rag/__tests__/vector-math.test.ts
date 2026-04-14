/**
 * 向量运算单元测试
 * 手写验证每个数学公式的正确性
 */

import { describe, it, expect } from 'vitest';
import {
  dotProduct,
  magnitude,
  cosineSimilarity,
  euclideanDistance,
  normalize,
  vectorAdd,
  vectorScale,
  vectorMean,
} from '../vector-math.js';

describe('dotProduct', () => {
  it('应正确计算点积', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32); // 1*4 + 2*5 + 3*6
  });

  it('正交向量点积为 0', () => {
    expect(dotProduct([1, 0], [0, 1])).toBe(0);
  });

  it('维度不匹配应抛出异常', () => {
    expect(() => dotProduct([1, 2], [1, 2, 3])).toThrow('dimensions mismatch');
  });

  it('零向量点积为 0', () => {
    expect(dotProduct([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('magnitude', () => {
  it('应正确计算模长', () => {
    expect(magnitude([3, 4])).toBe(5); // √(9+16)
  });

  it('单位向量模长为 1', () => {
    expect(magnitude([1, 0, 0])).toBe(1);
  });

  it('零向量模长为 0', () => {
    expect(magnitude([0, 0, 0])).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('相同向量相似度为 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('相反向量相似度为 -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('正交向量相似度为 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('长度不同但方向相同的向量相似度为 1', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });

  it('零向量应返回 0', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe('euclideanDistance', () => {
  it('应正确计算距离', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
  });

  it('相同向量距离为 0', () => {
    expect(euclideanDistance([1, 2], [1, 2])).toBe(0);
  });

  it('维度不匹配应抛出异常', () => {
    expect(() => euclideanDistance([1], [1, 2])).toThrow('dimensions mismatch');
  });
});

describe('normalize', () => {
  it('归一化后模长应为 1', () => {
    const n = normalize([3, 4]);
    expect(Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]!)).toBeCloseTo(1);
  });

  it('归一化后方向不变', () => {
    const n = normalize([3, 4]);
    expect(n[0]! / n[1]!).toBeCloseTo(3 / 4);
  });

  it('零向量归一化应返回零向量', () => {
    const n = normalize([0, 0, 0]);
    expect(n).toEqual([0, 0, 0]);
  });

  it('单位向量归一化后不变', () => {
    const n = normalize([1, 0, 0]);
    expect(n[0]).toBeCloseTo(1);
    expect(n[1]).toBeCloseTo(0);
    expect(n[2]).toBeCloseTo(0);
  });
});

describe('vectorAdd', () => {
  it('应正确相加', () => {
    expect(vectorAdd([1, 2], [3, 4])).toEqual([4, 6]);
  });

  it('维度不匹配应抛出异常', () => {
    expect(() => vectorAdd([1], [1, 2])).toThrow('dimensions mismatch');
  });
});

describe('vectorScale', () => {
  it('应正确标量乘法', () => {
    expect(vectorScale([1, 2, 3], 2)).toEqual([2, 4, 6]);
  });

  it('乘以 0 应返回零向量', () => {
    expect(vectorScale([1, 2, 3], 0)).toEqual([0, 0, 0]);
  });
});

describe('vectorMean', () => {
  it('应正确计算均值', () => {
    expect(vectorMean([[1, 2], [3, 4]])).toEqual([2, 3]);
  });

  it('单个向量的均值就是自身', () => {
    expect(vectorMean([[5, 10]])).toEqual([5, 10]);
  });

  it('空数组应抛出异常', () => {
    expect(() => vectorMean([])).toThrow('empty');
  });
});
