/**
 * 示例代码：一个有意留有问题的计算器模块
 * 用于代码审查 Agent 演示
 */

// BUG: 未处理除以零
export function divide(a: number, b: number): number {
  return a / b;
}

// BUG: any 类型
export function processData(data: any) {
  console.log(data.name);
  return data.value * 2;
}

// SECURITY: 硬编码密钥
const API_KEY = "DEMO_API_KEY_REDACTED";

export async function fetchData(endpoint: string) {
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return response.json();
}

// STYLE: 过长函数
export function generateReport(
  users: Array<{ name: string; age: number; email: string; role: string }>,
  format: string,
  includeHeader: boolean,
  sortBy: string,
  filterMinAge: number
) {
  let result = '';
  if (includeHeader) {
    result += 'User Report\n';
    result += '===========\n';
  }
  const filtered = users.filter(u => u.age >= filterMinAge);
  if (sortBy === 'name') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === 'age') {
    filtered.sort((a, b) => a.age - b.age);
  }
  for (const user of filtered) {
    if (format === 'csv') {
      result += `${user.name},${user.age},${user.email},${user.role}\n`;
    } else if (format === 'json') {
      result += JSON.stringify(user) + '\n';
    } else {
      result += `Name: ${user.name}, Age: ${user.age}, Email: ${user.email}, Role: ${user.role}\n`;
    }
  }
  return result;
}

// BUG: 未处理空数组
export function getAverage(numbers: number[]): number {
  const sum = numbers.reduce((acc, n) => acc + n, 0);
  return sum / numbers.length;
}

// SECURITY: eval 使用
export function calculate(expression: string): number {
  return eval(expression);
}
