/**
 * 示例代码：用户服务模块（带有多种问题）
 */

interface User {
  id: number;
  name: string;
  email: string;
  password: string;
}

const users: User[] = [];

// SECURITY: 密码未加密存储
export function createUser(name: string, email: string, password: string): User {
  const user: User = {
    id: users.length + 1,
    name,
    email,
    password, // 明文存储
  };
  users.push(user);
  return user;
}

// BUG: 线性搜索 + 未处理 not found
export function findUser(id: number): User {
  return users.find(u => u.id === id)!;
}

// SECURITY: SQL 注入风险（模拟）
export function queryUser(nameInput: string): string {
  const sql = `SELECT * FROM users WHERE name = '${nameInput}'`;
  return sql;
}

// STYLE: 魔法数字
export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128 && /[A-Z]/.test(password) && /[0-9]/.test(password);
}

// BUG: 异步错误未处理
export async function sendEmail(to: string, subject: string, body: string) {
  const response = await fetch('https://api.email.com/send', {
    method: 'POST',
    body: JSON.stringify({ to, subject, body }),
  });
  const data = await response.json();
  return data;
}

// STYLE: 嵌套过深
export function processOrder(order: any) {
  if (order) {
    if (order.items) {
      if (order.items.length > 0) {
        if (order.payment) {
          if (order.payment.status === 'completed') {
            return { success: true, orderId: order.id };
          } else {
            return { success: false, reason: 'payment not completed' };
          }
        } else {
          return { success: false, reason: 'no payment info' };
        }
      } else {
        return { success: false, reason: 'empty cart' };
      }
    } else {
      return { success: false, reason: 'no items' };
    }
  } else {
    return { success: false, reason: 'no order' };
  }
}
