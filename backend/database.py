from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime
import os

# กำหนดที่เก็บไฟล์ฐานข้อมูล SQLite
DATABASE_URL = "sqlite:///./database.db"

# สร้าง Engine สำหรับเชื่อมต่อฐานข้อมูล
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
# สร้าง Session สำหรับการจัดการ Transaction
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# โมเดลสำหรับเก็บข้อมูลการแชท (Chat Session)
class Chat(Base):
    __tablename__ = "chats"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, default="New Chat")
    user_id = Column(String, index=True, default="guest")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # ความสัมพันธ์กับโมเดล Message (หนึ่งแชทมีได้หลายข้อความ)
    messages = relationship("Message", back_populates="chat", cascade="all, delete-orphan")

# โมเดลสำหรับเก็บข้อความแต่ละข้อความ (Message)
class Message(Base):
    __tablename__ = "messages"
    
    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"))
    user_id = Column(String, index=True, default="guest") # รหัสผู้ใช้หรืออีเมลที่ส่งข้อความ
    role = Column(String) # "user" (ผู้ใช้) หรือ "assistant" (AI)
    content = Column(String) # เนื้อหาข้อความ
    model_name = Column(String, nullable=True) # ชื่อโมเดล AI ที่ใช้ตอบ
    created_at = Column(DateTime, default=datetime.utcnow)
    
    chat = relationship("Chat", back_populates="messages")

# ฟังก์ชันสำหรับสร้าง Table ในฐานข้อมูล (ถ้ายังไม่มี)
def init_db():
    Base.metadata.create_all(bind=engine)

# ฟังก์ชันสำหรับสร้าง Database Session เพื่อนำไปใช้งานใน API
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
