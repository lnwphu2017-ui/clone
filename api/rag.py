"""
rag.py — โมดูลระบบ Full RAG สำหรับค้นหาข้อมูลจากไฟล์ความรู้หลังบ้าน
แนวคิด:
  1. Parsing — อ่านข้อความจากไฟล์ PDF / TXT / DOCX
  2. Chunking — ตัดข้อความออกเป็นท่อนๆ พร้อม Overlap
  3. Embedding — แปลงแต่ละท่อนเป็น Vector (ด้วย sentence-transformers ฟรี 100%)
  4. Retrieval — เมื่อมีคำถาม หา Chunk ที่ "ความหมายใกล้เคียงที่สุด" ด้วย Cosine Similarity
"""

import os
# ต้องตั้งก่อน import อื่นๆ ทั้งหมด เพื่อป้องกัน transformers โหลด TensorFlow/Keras
os.environ["USE_TF"] = "0"
os.environ["USE_TORCH"] = "1"

import json
import numpy as np
from pathlib import Path
from typing import Optional, List, Dict

# --------------------------------------------------------
# ค่าคงที่สำหรับปรับจูนระบบ RAG
# --------------------------------------------------------
KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"  # โฟลเดอร์เก็บไฟล์ความรู้
CHUNK_SIZE = 800          # จำนวนตัวอักษรต่อ 1 Chunk
CHUNK_OVERLAP = 150       # ตัวอักษร Overlap ระหว่าง Chunk เพื่อป้องกันประโยคขาด
TOP_K_RESULTS = 5         # จำนวน Chunk ที่จะดึงมาใส่ Context

# --------------------------------------------------------
# Lazy Load โมเดล Embedding (โหลดครั้งเดียว เก็บไว้ใน Memory)
# ใช้ all-MiniLM-L6-v2 — เบาเพียง ~90MB รองรับทั้งไทยและอังกฤษ
# --------------------------------------------------------
_embedding_model = None

def GetEmbeddingModel():
    """โหลดโมเดล Embedding แบบ Lazy (โหลดครั้งแรกที่เรียกใช้เท่านั้น)"""
    global _embedding_model
    if _embedding_model is None:
        try:
            # บังคับให้ transformers ไม่โหลด TensorFlow/Keras (แก้ปัญหา "No module named keras")
            os.environ["USE_TF"] = "0"
            os.environ["USE_TORCH"] = "1"
            from sentence_transformers import SentenceTransformer
            # ใช้โมเดลที่รองรับภาษาไทยและอังกฤษได้ดี ขนาดเล็ก รวดเร็ว
            _embedding_model = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
        except Exception as e:
            raise RuntimeError(f"ไม่สามารถโหลดโมเดล Embedding ได้: {e}")
    return _embedding_model


# --------------------------------------------------------
# Step 1: Parsing — อ่านข้อความจากไฟล์แต่ละประเภท
# --------------------------------------------------------

def ParseTxtFile(file_path: Path) -> str:
    """อ่านข้อความจากไฟล์ .txt รองรับหลาย Encoding"""
    for encoding in ["utf-8", "utf-8-sig", "tis-620", "cp874"]:
        try:
            return file_path.read_text(encoding=encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    # fallback: อ่านแบบ ignore errors
    return file_path.read_text(encoding="utf-8", errors="ignore")


def ParsePdfFile(file_path: Path) -> str:
    """อ่านข้อความจากไฟล์ .pdf ด้วย PyPDF2"""
    try:
        import PyPDF2
        text_parts = []
        with open(file_path, "rb") as pdf_file:
            reader = PyPDF2.PdfReader(pdf_file)
            for page_num, page in enumerate(reader.pages):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    # ระบุหน้าต้นฉบับเพื่อช่วยในการอ้างอิง
                    text_parts.append(f"[หน้า {page_num + 1}]\n{page_text}")
        return "\n\n".join(text_parts)
    except Exception as e:
        return f"[Error reading PDF: {e}]"


def ParseDocxFile(file_path: Path) -> str:
    """อ่านข้อความจากไฟล์ .docx ด้วย python-docx"""
    try:
        from docx import Document
        doc = Document(file_path)
        paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
        return "\n\n".join(paragraphs)
    except Exception as e:
        return f"[Error reading DOCX: {e}]"


def ParseFile(file_path: Path) -> Optional[str]:
    """
    เลือก Parser ที่เหมาะสมตามนามสกุลไฟล์
    คืนค่า None หากไม่รองรับประเภทไฟล์นั้น
    """
    suffix = file_path.suffix.lower()
    if suffix == ".txt":
        return ParseTxtFile(file_path)
    elif suffix == ".pdf":
        return ParsePdfFile(file_path)
    elif suffix in (".docx", ".doc"):
        return ParseDocxFile(file_path)
    else:
        # ข้ามไฟล์ที่ไม่รองรับ (เช่น .gitkeep, README)
        return None


# --------------------------------------------------------
# Step 2: Chunking — ตัดข้อความเป็นท่อนๆ พร้อม Overlap
# --------------------------------------------------------

def ChunkText(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """
    ตัดข้อความเป็น Chunk ขนาด chunk_size ตัวอักษร
    พร้อม Overlap เพื่อป้องกันประโยคสำคัญถูกตัดเป็นสองส่วน
    """
    if not text or not text.strip():
        return []

    chunks = []
    start = 0
    text_length = len(text)

    while start < text_length:
        end = start + chunk_size

        # พยายามตัดที่ช่องว่างหรือขึ้นบรรทัดใหม่ ไม่ตัดกลางคำ
        if end < text_length:
            # มองหา delimiter ล่าสุดภายใน 100 ตัวอักษรสุดท้ายของ Chunk
            split_pos = text.rfind("\n", start, end)
            if split_pos == -1 or split_pos <= start:
                split_pos = text.rfind(" ", end - 100, end)
            if split_pos > start:
                end = split_pos

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        # เลื่อน start ไปข้างหน้า โดยถอยหลัง overlap ตัวอักษรก่อน
        start = end - overlap if end - overlap > start else end

    return chunks


# --------------------------------------------------------
# Step 3: Embedding — แปลงข้อความเป็น Vector ด้วย Sentence Transformers
# --------------------------------------------------------

def EmbedTexts(texts: List[str]) -> List[List[float]]:
    """
    แปลงรายการข้อความเป็น Vector (Embedding)
    ใช้โมเดล sentence-transformers ที่รันบนเครื่อง ฟรี ไม่ต้องมี API Key
    """
    model = GetEmbeddingModel()
    embeddings = model.encode(texts, batch_size=32, show_progress_bar=False)
    # แปลงจาก numpy array เป็น list เพื่อเก็บลง JSON ในฐานข้อมูล
    return [emb.tolist() for emb in embeddings]


# --------------------------------------------------------
# Step 4: Retrieval — ค้นหา Chunk ที่เกี่ยวข้องด้วย Cosine Similarity
# --------------------------------------------------------

def ComputeCosineSimilarity(vec_a: List[float], vec_b: List[float]) -> float:
    """
    คำนวณ Cosine Similarity ระหว่าง Vector 2 ตัว
    ค่า 1.0 = เหมือนกันทุกประการ, ค่า 0.0 = ไม่เกี่ยวข้องกันเลย
    """
    a = np.array(vec_a)
    b = np.array(vec_b)
    # ป้องกัน division by zero ในกรณี vector เป็นศูนย์
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def RetrieveRelevantChunks(query: str, db, top_k: int = TOP_K_RESULTS) -> List[Dict]:
    """
    ค้นหา Chunk ที่ตรงกับ query มากที่สุด
    คืนค่า list ของ dict: {content, source, score}
    """
    from .database import KnowledgeChunk

    # ดึง Chunk ทั้งหมดจาก DB
    all_chunks = db.query(KnowledgeChunk).all()
    if not all_chunks:
        return []

    # แปลงคำถามของผู้ใช้เป็น Vector
    query_embedding = EmbedTexts([query])[0]

    # คำนวณ Similarity ระหว่างคำถามกับทุก Chunk
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
        except (json.JSONDecodeError, TypeError):
            # ข้าม Chunk ที่ Embedding เสียหาย
            continue

    # เรียงลำดับคะแนนจากสูงไปต่ำ และเลือก Top K
    scored_chunks.sort(key=lambda x: x["score"], reverse=True)
    return scored_chunks[:top_k]


# --------------------------------------------------------
# Step ผสม: IndexKnowledgeFiles — ทำ Index ไฟล์ทั้งหมดในโฟลเดอร์ knowledge
# --------------------------------------------------------

def IndexKnowledgeFiles(db) -> dict:
    """
    อ่านไฟล์ทั้งหมดในโฟลเดอร์ knowledge แล้ว:
    1. Parse ข้อความออกมา
    2. ตัดเป็น Chunk
    3. ทำ Embedding
    4. บันทึกลงฐานข้อมูล
    คืนค่า dict สรุปผล: {files_processed, chunks_created, errors}
    """
    from .database import KnowledgeChunk

    # สร้างโฟลเดอร์ถ้ายังไม่มี
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)

    result = {"files_processed": 0, "chunks_created": 0, "errors": []}

    # ดึงรายชื่อไฟล์ทั้งหมดที่รองรับ
    supported_files = [
        f for f in KNOWLEDGE_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in (".txt", ".pdf", ".docx", ".doc")
    ]

    if not supported_files:
        return {"files_processed": 0, "chunks_created": 0, "errors": ["ไม่พบไฟล์ในโฟลเดอร์ knowledge"]}

    # ลบข้อมูล Index เก่าออกก่อน Index ใหม่
    db.query(KnowledgeChunk).delete()
    db.commit()

    for file_path in supported_files:
        try:
            # 1. Parse ข้อความจากไฟล์
            raw_text = ParseFile(file_path)
            if not raw_text or not raw_text.strip():
                result["errors"].append(f"ไม่สามารถอ่านข้อความจาก {file_path.name}")
                continue

            # 2. ตัดเป็น Chunk
            chunks = ChunkText(raw_text)
            if not chunks:
                result["errors"].append(f"ไม่มีเนื้อหาใน {file_path.name}")
                continue

            # 3. ทำ Embedding ทุก Chunk ในคราวเดียว (ประหยัดเวลา)
            embeddings = EmbedTexts(chunks)

            # 4. บันทึกลง DB
            for chunk_text, embedding in zip(chunks, embeddings):
                db_chunk = KnowledgeChunk(
                    source_file=file_path.name,
                    content=chunk_text,
                    embedding=json.dumps(embedding)   # เก็บเป็น JSON String
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
    """
    สร้างข้อความ Context จาก Chunk ที่ค้นหาได้
    นำไปใส่ใน System Prompt ของ AI
    """
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
