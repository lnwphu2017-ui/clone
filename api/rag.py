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
KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"  # โฟลเดอร์เก็บไฟล์ความรู้
CHUNK_SIZE = 2000         # ขยายขนาดเพื่อให้วิชาอยู่รวมกัน ไม่โดนตัดแบ่งท่อน
CHUNK_OVERLAP = 300       # เพิ่ม Overlap เพื่อความต่อเนื่อง
TOP_K_RESULTS = 25        # ดึงทุกอย่างที่มี (เพื่อให้ได้ข้อมูลครบ 100%)
SIMILARITY_THRESHOLD = 0.1 # ไม่กรองทิ้งเลย เพื่อป้องกันวิชาหาย ✅
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
        return [data.embedding for data in response.data]
    except Exception as e:
        print(f"❌ Embedding API Error: {str(e)}")
        raise RuntimeError(f"ไม่สามารถขอค่า Embedding จาก API ได้: {str(e)}")

# --------------------------------------------------------
# Step 4: Retrieval — ค้นหาด้วย Cosine Similarity (Pure Python)
# --------------------------------------------------------

def ComputeCosineSimilarity(vec_a: List[float], vec_b: List[float]) -> float:
    dot_product = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot_product / (norm_a * norm_b)

def RetrieveRelevantChunks(query: str, db, api_key: str, top_k: int = TOP_K_RESULTS) -> List[Dict]:
    """
    ค้นหา Chunk ที่ตรงกับ query มากที่สุด
    1. กรองเฉพาะที่ score >= SIMILARITY_THRESHOLD
    2. จัดลำดับใหม่ตามต้นฉบับ (Original Order) เพื่อให้ AI ไม่งง
    """
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
                "id": chunk.id,
                "content": chunk.content,
                "source": chunk.source_file,
                "score": score
            })
        except: continue

    scored_chunks.sort(key=lambda x: x["score"], reverse=True)
    filtered_chunks = [c for c in scored_chunks[:top_k] if c["score"] >= SIMILARITY_THRESHOLD]

    # --- หัวใจสำคัญ: เรียงลำดับกลับตาม ID เพื่อให้เนื้อหาต่อเนื่องกันตามเอกสารต้นฉบับ ---
    filtered_chunks.sort(key=lambda x: x["id"])

    if scored_chunks:
        print(f"🔍 RAG Search | Top Score: {scored_chunks[0]['score']:.4f} | Threshold: {SIMILARITY_THRESHOLD} | Found: {len(filtered_chunks)}")

    return filtered_chunks

# --------------------------------------------------------
# Step ผสม: IndexKnowledgeFiles
# --------------------------------------------------------

def IndexKnowledgeFiles(db, api_key: str) -> dict:
    from .database import KnowledgeChunk
    import re

    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    result = {"files_processed": 0, "chunks_created": 0, "errors": []}

    supported_files = [
        f for f in KNOWLEDGE_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in (".txt", ".pdf", ".docx", ".doc")
    ]

    if not supported_files:
        return {"files_processed": 0, "chunks_created": 0, "errors": ["ไม่พบไฟล์ในโฟลเดอร์ knowledge"]}

    db.query(KnowledgeChunk).delete()
    db.commit()

    for file_path in supported_files:
        try:
            raw_text = ParseFile(file_path)
            if not raw_text or not raw_text.strip():
                result["errors"].append(f"ไม่สามารถอ่านข้อความจาก {file_path.name}")
                continue

            processed_chunks = []
            if file_path.name == "syllabus.txt":
                current_year_context = ""
                lines = raw_text.split("\n")
                current_buffer = []
                
                for line in lines:
                    year_match = re.search(r"(ชั้นปีที่\s*\d+|รายชื่อวิชาปี\s*\d+)", line)
                    if year_match:
                        if current_buffer:
                            text_to_chunk = "\n".join(current_buffer)
                            chunks = ChunkText(text_to_chunk)
                            for c in chunks:
                                processed_chunks.append(f"ข้อมูลนี้คือรายชื่อวิชาของ {current_year_context}: {c}")
                            current_buffer = []
                        current_year_context = year_match.group(0).strip()
                    current_buffer.append(line)
                
                if current_buffer:
                    text_to_chunk = "\n".join(current_buffer)
                    chunks = ChunkText(text_to_chunk)
                    for c in chunks:
                        processed_chunks.append(f"ข้อมูลนี้คือรายชื่อวิชาของ {current_year_context}: {c}")
            else:
                processed_chunks = ChunkText(raw_text)

            if not processed_chunks:
                continue

            embeddings = EmbedTexts(processed_chunks, api_key)

            for chunk_text, embedding in zip(processed_chunks, embeddings):
                db_chunk = KnowledgeChunk(
                    source_file=file_path.name,
                    content=chunk_text,
                    embedding=json.dumps(embedding)
                )
                db.add(db_chunk)

            db.commit()
            result["files_processed"] += 1
            result["chunks_created"] += len(processed_chunks)

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
