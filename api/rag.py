"""
rag.py — โมดูลระบบ Full RAG แบบ API-based
แนวคิดหลัก:
  1. Parsing — อ่านข้อความจากไฟล์ PDF / TXT / DOCX
  2. Chunking — ตัดข้อความเป็นท่อนๆ พร้อม Overlap
  3. Embedding — แปลงข้อความเป็น Vector ผ่าน API (OpenRouter/OpenAI)
  4. Retrieval — ค้นหาความใกล้เคียงด้วยการคำนวณ Cosine Similarity (Pure Python)
"""

import os
import json
import math
from pathlib import Path
from typing import Optional, List, Dict
from openai import OpenAI

# --------------------------------------------------------
# ค่าคงที่สำหรับปรับจูนระบบ RAG
# --------------------------------------------------------
KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"
CHUNK_SIZE = 800
CHUNK_OVERLAP = 150
TOP_K_RESULTS = 5
EMBEDDING_MODEL = "openai/text-embedding-3-small" # โมเดลแนะนำ: ราคาประหยัดและแม่นยำสูง

# --------------------------------------------------------
# Step 1: Parsing — อ่านข้อความจากไฟล์
# --------------------------------------------------------

def ParseTxtFile(file_path: Path) -> str:
    for encoding in ["utf-8", "utf-8-sig", "tis-620", "cp874"]:
        try:
            return file_path.read_text(encoding=encoding)
        except:
            continue
    return file_path.read_text(encoding="utf-8", errors="ignore")

def ParsePdfFile(file_path: Path) -> str:
    try:
        import PyPDF2
        text_parts = []
        with open(file_path, "rb") as pdf_file:
            reader = PyPDF2.PdfReader(pdf_file)
            for page_num, page in enumerate(reader.pages):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    text_parts.append(f"[หน้า {page_num + 1}]\n{page_text}")
        return "\n\n".join(text_parts)
    except Exception as e:
        return f"[Error reading PDF: {e}]"

def ParseDocxFile(file_path: Path) -> str:
    try:
        from docx import Document
        doc = Document(file_path)
        paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
        return "\n\n".join(paragraphs)
    except Exception as e:
        return f"[Error reading DOCX: {e}]"

def ParseFile(file_path: Path) -> Optional[str]:
    suffix = file_path.suffix.lower()
    if suffix == ".txt":
        return ParseTxtFile(file_path)
    elif suffix == ".pdf":
        return ParsePdfFile(file_path)
    elif suffix in (".docx", ".doc"):
        return ParseDocxFile(file_path)
    return None

# --------------------------------------------------------
# Step 2: Chunking — ตัดข้อความเป็นท่อนๆ
# --------------------------------------------------------

def ChunkText(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    if not text or not text.strip():
        return []
    chunks = []
    start = 0
    text_length = len(text)
    while start < text_length:
        end = start + chunk_size
        if end < text_length:
            split_pos = text.rfind("\n", start, end)
            if split_pos == -1 or split_pos <= start:
                split_pos = text.rfind(" ", end - 100, end)
            if split_pos > start:
                end = split_pos
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end - overlap if end - overlap > start else end
    return chunks

# --------------------------------------------------------
# Step 3: Embedding — แปลงข้อความเป็น Vector ผ่าน API
# --------------------------------------------------------

def EmbedTexts(texts: List[str], api_key: str) -> List[List[float]]:
    """เรียกใช้ API ของ OpenRouter เพื่อขอค่า Embedding"""
    if not api_key:
        raise ValueError("ต้องการ API Key สำหรับการทำ Embedding")
    
    try:
        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts
        )
        # สกัดข้อมูลผลลัพธ์ออกมาเป็นลิสต์ของเวกเตอร์
        # ผลลัพธ์ที่ได้จาก API จะเรียงตามลำดับ input อยู่แล้วครับ
        return [data.embedding for data in response.data]
    except Exception as e:
        print(f"❌ Embedding API Error: {str(e)}")
        raise RuntimeError(f"ไม่สามารถขอค่า Embedding จาก API ได้: {str(e)}")

# --------------------------------------------------------
# Step 4: Retrieval — ค้นหาด้วย Cosine Similarity (Pure Python)
# --------------------------------------------------------

def ComputeCosineSimilarity(vec_a: List[float], vec_b: List[float]) -> float:
    """คำนวณความใกล้เคียงด้วยวิธีทางคณิตศาสตร์แบบไม่ใช้ numpy เพื่อลดขนาด Dependency"""
    dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot_product / (norm_a * norm_b)

def RetrieveRelevantChunks(query: str, db, api_key: str, top_k: int = TOP_K_RESULTS) -> List[Dict]:
    from .database import KnowledgeChunk
    
    all_chunks = db.query(KnowledgeChunk).all()
    if not all_chunks:
        return []

    # แปลงคำถามเป็นเวกเตอร์ผ่าน API
    query_embedding = EmbedTexts([query], api_key)[0]

    scored_chunks = []
    for chunk in all_chunks:
        try:
            chunk_embedding = json.loads(chunk.embedding)
            score = ComputeCosineSimilarity(query_embedding, chunk_embedding)
            scored_chunks.append({
                "content": chunk.content,
                "source": chunk.source_file,
                "score": score
            })
        except:
            continue

    scored_chunks.sort(key=lambda x: x["score"], reverse=True)
    return scored_chunks[:top_k]

# --------------------------------------------------------
# Step ผสม: IndexKnowledgeFiles
# --------------------------------------------------------

def IndexKnowledgeFiles(db, api_key: str) -> dict:
    from .database import KnowledgeChunk
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    result = {"files_processed": 0, "chunks_created": 0, "errors": []}

    supported_files = [
        f for f in KNOWLEDGE_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in (".txt", ".pdf", ".docx", ".doc")
    ]

    if not supported_files:
        return {"files_processed": 0, "chunks_created": 0, "errors": ["ไม่พบไฟล์ในโฟลเดอร์ knowledge"]}

    # เคลียร์ข้อมูลเดิม
    db.query(KnowledgeChunk).delete()
    db.commit()

    for file_path in supported_files:
        try:
            raw_text = ParseFile(file_path)
            if not raw_text or not raw_text.strip():
                result["errors"].append(f"ไม่สามารถอ่านข้อความจาก {file_path.name}")
                continue

            chunks = ChunkText(raw_text)
            if not chunks:
                continue

            # ทำ Embedding ทุก Chunk ผ่าน API
            embeddings = EmbedTexts(chunks, api_key)

            for chunk_text, embedding in zip(chunks, embeddings):
                db_chunk = KnowledgeChunk(
                    source_file=file_path.name,
                    content=chunk_text,
                    embedding=json.dumps(embedding)
                )
                db.add(db_chunk)

            db.commit()
            result["files_processed"] += 1
            result["chunks_created"] += len(chunks)

        except Exception as e:
            db.rollback()
            result["errors"].append(f"Error processing {file_path.name}: {str(e)}")

    return result

def BuildRagContext(relevant_chunks: List[Dict]) -> str:
    if not relevant_chunks:
        return ""
    context_parts = ["=== ข้อมูลจากฐานความรู้ที่เกี่ยวข้อง ==="]
    for i, chunk in enumerate(relevant_chunks, 1):
        score_pct = int(chunk["score"] * 100)
        context_parts.append(
            f"\n[แหล่งที่มา: {chunk['source']} | ความเกี่ยวข้อง: {score_pct}%]\n{chunk['content']}"
        )
    context_parts.append("\n=== สิ้นสุดข้อมูลอ้างอิง ===")
    return "\n".join(context_parts)
