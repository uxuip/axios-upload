import axios, { AxiosHeaders } from 'axios'
import type { AxiosProgressEvent, AxiosRequestConfig, AxiosRequestTransformer, AxiosResponseTransformer } from 'axios'

// 请求头类型
type HeadersType = Headers | AxiosHeaders | Record<string, string | number | null | undefined>

// 上传请求配置
export interface UploadRequestOptions {
  action: string
  method: string
  data: any
  headers: HeadersType
  onError: (err: unknown) => void
  onProgress: (evt: AxiosProgressEvent) => void
  onSuccess: (response: any) => void
  withCredentials: boolean
  // 分块上传，每块的大小，<=0则不分块
  chunkSize?: number
  // 文件
  file: File | FileChunk
  transformRequest?: AxiosRequestTransformer | AxiosRequestTransformer[]
  transformResponse?: AxiosResponseTransformer | AxiosResponseTransformer[]
}

// 文件分块
export class FileChunk extends File {
  raw: File
  constructor(file: File, public start: number, public end: number) {
    super([file.slice(start, end)], file.name, {
      lastModified: file.lastModified,
      type: file.type,
    })
    this.raw = file
  }
}

const abortMap = new WeakMap<File, AbortController>()

/**
 * 转换请求头
 * @param headers 请求头
 */
function transformHeaders(headers: HeadersType): AxiosHeaders {
  const axiosHeaders = new AxiosHeaders()
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      headers.append(key, value)
    })
  }
  else {
    Object.entries(headers).forEach(([key, value]) => {
      axiosHeaders.append(key, value)
    })
  }
  return axiosHeaders
}

/**
 * 上传请求
 * @param options 上传配置
 */
function uploadRequest(options: UploadRequestOptions) {
  const rawFile = options.file
  const headers = transformHeaders(options.headers)
  const controller = new AbortController()

  headers.set('Content-Type', 'multipart/form-data')
  abortMap.set(rawFile instanceof FileChunk ? rawFile.raw : rawFile, controller)

  const config: AxiosRequestConfig = {
    method: 'post',
    url: options.action,
    data: {
      ...options.data,
      file: rawFile,
    },
    signal: controller.signal,
    headers,
    withCredentials: options.withCredentials,
    transformRequest: options.transformRequest,
    transformResponse: options.transformResponse,
    onUploadProgress: options.onProgress,
  }

  return axios(config)
}

/**
 * 文件上传
 * @param options 上传配置
 */
function uploadFile(options: UploadRequestOptions) {
  return uploadRequest(options)
    .then(options.onSuccess)
    .catch(options.onError)
}

/**
 * 文件分块上传
 * @param options 上传配置
 */
async function uploadFileChunk(options: UploadRequestOptions) {
  const rawFile = options.file
  const chunkSize = options?.chunkSize ?? 0
  const chunkCount = chunkSize > 0 ? Math.ceil(rawFile.size / chunkSize) : 1
  // 上传总进度
  let progressTotal = 0
  // 上传当前进度
  let progressLoaded = 0
  for (let i = 0; i < chunkCount; i++) {
    try {
      const chunkStart = i * chunkSize
      const chunkEnd = Math.min(rawFile.size, chunkStart + chunkSize)
      const chunk = new FileChunk(rawFile, chunkStart, chunkEnd)

      const res = await uploadRequest({
        ...options,
        file: chunk,
        onProgress: (e) => {
          progressLoaded = e.loaded
          options.onProgress({
            ...e,
            loaded: (progressTotal + progressLoaded),
            total: rawFile.size,
            progress: (progressTotal + progressLoaded) / rawFile.size,
          })
        },
      })

      progressTotal += progressLoaded
      // 上传完成
      if (progressTotal >= rawFile.size)
        options.onSuccess(res)
    }
    catch (err) {
      options.onError(err)
      break
    }
  }
}

/**
 * 上传
 * @param options 上传配置
 */
export function upload(options: UploadRequestOptions) {
  const isChunkUpload = !!options?.chunkSize && options.chunkSize > 0
  isChunkUpload ? uploadFileChunk(options) : uploadFile(options)
}

/**
 * 取消上传
 * @param files 要取消上传的文件
 */
export function abort(files: File | File[]) {
  files = Array.isArray(files) ? files : [files]
  files.forEach((file) => {
    const controller = abortMap.get(file)
    if (controller) {
      controller.abort()
      abortMap.delete(file)
    }
  })
}
