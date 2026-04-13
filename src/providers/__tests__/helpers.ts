/**
 * 测试辅助工具
 * 用于构造 mock 的 HTTP Response，模拟 LLM API 返回
 */

/**
 * 构造一个 mock JSON Response（模拟非流式 API 返回）
 */
export function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 构造一个 mock SSE Response（模拟流式 API 返回）
 * 接收一组 SSE data 行的 payload，自动拼接为 SSE 格式
 */
export function mockSSEResponse(chunks: unknown[], status = 200): Response {
  const lines = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);
  lines.push('data: [DONE]\n\n');
  const text = lines.join('');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * 构造分片到达的 SSE Response（模拟网络分包）
 * 用于测试 SSE 解析器的缓冲区逻辑
 */
export function mockChunkedSSEResponse(
  chunks: unknown[],
  chunkSize = 20,
  status = 200
): Response {
  const lines = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);
  lines.push('data: [DONE]\n\n');
  const fullText = lines.join('');

  const encoder = new TextEncoder();
  const bytes = encoder.encode(fullText);

  const stream = new ReadableStream({
    start(controller) {
      let offset = 0;
      while (offset < bytes.length) {
        const end = Math.min(offset + chunkSize, bytes.length);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * 构造一个错误 Response
 */
export function mockErrorResponse(
  message: string,
  status = 400
): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
