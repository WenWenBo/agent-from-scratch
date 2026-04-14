# TypeScript 快速入门指南

## 什么是 TypeScript？

TypeScript 是由微软开发的开源编程语言。它是 JavaScript 的超集，添加了静态类型系统和面向对象编程特性。TypeScript 代码会被编译成纯 JavaScript，可以运行在任何支持 JavaScript 的环境中。

## 核心特性

### 1. 静态类型系统

TypeScript 最重要的特性是其静态类型系统。通过类型注解，开发者可以在编译时发现潜在的错误。

```typescript
let name: string = "Alice";
let age: number = 30;
let isActive: boolean = true;
```

### 2. 接口（Interface）

接口用于定义对象的结构：

```typescript
interface User {
  id: number;
  name: string;
  email: string;
  role?: string; // 可选属性
}
```

### 3. 泛型（Generics）

泛型允许创建可重用的组件：

```typescript
function identity<T>(arg: T): T {
  return arg;
}
```

### 4. 枚举（Enum）

```typescript
enum Direction {
  Up,
  Down,
  Left,
  Right,
}
```

## 常用工具

- **tsc**: TypeScript 编译器
- **ts-node**: 直接运行 TypeScript
- **Vitest**: 现代化测试框架
- **ESLint**: 代码质量检查

## 最佳实践

1. 尽量使用 `const` 和 `let`，避免 `var`
2. 启用严格模式（`"strict": true`）
3. 使用接口定义数据结构
4. 避免使用 `any` 类型
5. 为函数参数和返回值添加类型注解
