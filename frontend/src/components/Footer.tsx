import Link from "next/link"

export default function Footer() {
  return (
    <footer className="bg-white border-t border-gray-200 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">产品</h4>
            <ul className="space-y-1 text-gray-600">
              <li><Link href="/models" className="hover:text-indigo-600">模型广场</Link></li>
              <li><Link href="/docs" className="hover:text-indigo-600">开发者文档</Link></li>
              <li><Link href="/dashboard" className="hover:text-indigo-600">控制台</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">政策</h4>
            <ul className="space-y-1 text-gray-600">
              <li><Link href="/terms" className="hover:text-indigo-600">服务条款</Link></li>
              <li><Link href="/privacy" className="hover:text-indigo-600">隐私政策</Link></li>
              <li><Link href="/sla" className="hover:text-indigo-600">服务等级</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">关于</h4>
            <ul className="space-y-1 text-gray-600">
              <li><Link href="/about" className="hover:text-indigo-600">关于天枢</Link></li>
              <li>
                <a href="mailto:support@tianshu-gateway.cloud" className="hover:text-indigo-600">
                  联系我们
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">免责声明</h4>
            <p className="text-gray-500 text-xs leading-relaxed">
              天枢是一个开放聚合平台，模型内容由第三方提供者提供。平台不对生成内容的准确性或合法性负责，
              使用前请阅读
              <Link href="/terms" className="text-indigo-600 hover:underline ml-1">服务条款</Link>。
            </p>
          </div>
        </div>
        <div className="border-t border-gray-100 mt-6 pt-4 text-xs text-gray-500 flex flex-wrap justify-between gap-2">
          <span>© {new Date().getFullYear()} 天枢 · Tianshu Gateway</span>
          <span>OpenAI-compatible LLM aggregation platform</span>
        </div>
      </div>
    </footer>
  )
}
