import { DeleteObjectCommand, GetObjectCommand, S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function client() {
  const account = process.env.R2_ACCOUNT_ID;
  if (!account || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) throw new Error("Armazenamento de comprovantes não configurado.");
  return new S3Client({ region: "auto", endpoint: `https://${account}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
}

export async function signedUploadUrl(key: string, contentType: string, contentLength?: number) {
  return getSignedUrl(client(), new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: contentType, ...(contentLength ? { ContentLength: contentLength } : {}) }), { expiresIn: 300 });
}

export async function uploadObject(key: string, body: Uint8Array, contentType: string, metadata?: Record<string, string>) {
  if (!process.env.R2_BUCKET) throw new Error("Armazenamento de arquivos não configurado.");
  await client().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: body, ContentType: contentType, Metadata: metadata }));
  return key;
}

export async function signedDownloadUrl(key: string, fileName: string) {
  if (!process.env.R2_BUCKET) throw new Error("Armazenamento de arquivos não configurado.");
  const safeName = fileName.replace(/[\r\n"\\]/g, "_");
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ResponseContentDisposition: `attachment; filename="${safeName}"` }), { expiresIn: 120 });
}

export async function deleteObject(key: string) {
  if (!process.env.R2_BUCKET) throw new Error("Armazenamento de arquivos não configurado.");
  await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
}

export async function getObjectBytes(key: string) {
  if (!process.env.R2_BUCKET) throw new Error("Armazenamento de arquivos não configurado.");
  const response = await client().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  if (!response.Body) throw new Error("Arquivo não encontrado no armazenamento.");
  return response.Body.transformToByteArray();
}
