# ใช้ Python 3.8-slim เพื่อความเบาและเสถียร
FROM python:3.8-slim

# ตั้งค่า Working Directory
WORKDIR /app

# ติดตั้ง System Dependencies ที่จำเป็นสำหรับ Python Packages บางตัว
RUN apt-get update && apt-get install -y \
    build-essential \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# ตั้งค่า Environment Variables เพื่อป้องกันปัญหา TensorFlow/Keras
ENV USE_TF=0
ENV USE_TORCH=1
ENV PYTHONUNBUFFERED=1

# ก๊อปปี้ requirements.txt และติดตั้งหมวดหมู่หลัก
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ก๊อปปี้โค้ดทั้งหมด (api และ frontend)
COPY . .

# เปิดพอร์ต 8000
EXPOSE 8000

# รันแอปด้วย uvicorn
# หมายเหตุ: เรา bind ไปที่ 0.0.0.0 เพื่อให้เข้าถึงจากภายนอกคอนเทนเนอร์ได้
CMD ["python", "-m", "uvicorn", "api.index:app", "--host", "0.0.0.0", "--port", "8000"]
