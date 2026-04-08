import httpx
import asyncio

async def test():
    url = "http://host.docker.internal:11434/api/tags"
    print(f"🔍 กำลังลองเชื่อมต่อกับ: {url}")
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, timeout=5.0)
            print(f"✅ สำเร็จ! Status Code: {r.status_code}")
            print("📦 รายชื่อโมเดลที่พบ:")
            for m in r.json().get('models', []):
                print(f" - {m['name']}")
    except Exception as e:
        print(f"❌ เชื่อมต่อไม่ได้: {str(e)}")
        print("\n💡 คำแนะนำ:")
        print("1. ตรวจสอบว่าเปิดแอป Ollama ใน Windows อยู่หรือไม่")
        print("2. ตรวจสอบว่าตั้งค่า OLLAMA_HOST=0.0.0.0 ใน Environment Variables หรือยัง")
        print("3. ลองรันคำสั่ง 'setx OLLAMA_HOST \"0.0.0.0\"' ใน CMD แล้ว Restart Ollama ครับ")

if __name__ == "__main__":
    asyncio.run(test())
