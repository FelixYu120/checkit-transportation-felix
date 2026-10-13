import os
import boto3
import psycopg
from dotenv import load_dotenv

load_dotenv()

print("Testing Supabase...")

with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
    with conn.cursor() as cur:
        cur.execute("select count(*) from public.traffic_passages")
        count = cur.fetchone()[0]

print("Supabase PASS:", count)

print("Testing R2...")

s3 = boto3.client(
    "s3",
    endpoint_url=(
        f"https://{os.environ['R2_ACCOUNT_ID']}"
        ".r2.cloudflarestorage.com"
    ),
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name="auto",
)

s3.head_bucket(Bucket=os.environ["R2_BUCKET"])

print("R2 PASS")