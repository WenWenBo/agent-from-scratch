/**
 * RAG 模块导出
 */

export type { Vector } from './vector-math.js';
export {
  dotProduct,
  magnitude,
  cosineSimilarity,
  euclideanDistance,
  normalize,
  vectorAdd,
  vectorScale,
  vectorMean,
} from './vector-math.js';

export type { Embedder, OpenAIEmbedderOptions } from './embedder.js';
export { OpenAIEmbedder, SimpleEmbedder } from './embedder.js';

export type { DocumentChunk, ChunkStrategy } from './chunker.js';
export {
  FixedSizeChunker,
  ParagraphChunker,
  MarkdownChunker,
} from './chunker.js';
export type { FixedSizeChunkerOptions, ParagraphChunkerOptions } from './chunker.js';

export type { VectorEntry, SearchResult, VectorStoreOptions } from './vector-store.js';
export { VectorStore } from './vector-store.js';

export type { RAGPipelineOptions } from './rag-pipeline.js';
export { RAGPipeline } from './rag-pipeline.js';
