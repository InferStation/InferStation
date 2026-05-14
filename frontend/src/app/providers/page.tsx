"use client"

import Link from "next/link"
import { useT } from "@/context/LocaleContext"

export default function ProvidersPage() {
  const t = useT()
  return (
    <div className="space-y-20 pb-20">
      <section className="text-center pt-20">
        <div className="inline-flex items-center gap-2 px-3 h-7 rounded-full border border-line bg-surface text-xs text-fg-muted mb-6">
          {t({ en: "82.4% revenue share · $50 minimum payout · monthly", zh: "82.4% 收入分成 · $50 起提 · 月结" })}
        </div>
        <h1 className="text-[44px] leading-[1.05] font-semibold tracking-tight mb-4">
          {t({ en: "Your GPU is asleep.", zh: "你的 GPU 在睡觉。" })}<br />
          <span className="text-fg-muted">{t({ en: "Tianshu wakes it up.", zh: "天枢把它叫醒。" })}</span>
        </h1>
        <p className="text-base text-fg-muted max-w-2xl mx-auto">
          {t({
            en: "A 4090 idles 18 hours a day. A pair of MI300X spends weekends fanning hot air. Tianshu routes paying token traffic to whatever you have — consumer card, home server, leased rack — and pays you 82.4% of every dollar that flows through.",
            zh: "一张 4090 平均每天闲 18 小时，两块 MI300X 周末几乎没事做。天枢把付费 token 流量调度到你已有的硬件上——消费卡、家用服务器、租用机柜都可以——把流过的每 1 美元的 82.4% 付给你。",
          })}
        </p>
        <div className="flex justify-center gap-2 flex-wrap mt-8">
          <Link href="/register" className="h-10 px-5 inline-flex items-center rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90">
            {t({ en: "Sign up & onboard", zh: "注册并上架" })}
          </Link>
          <Link href="/docs" className="h-10 px-5 inline-flex items-center rounded-lg bg-surface border border-line text-fg text-sm font-medium hover:bg-accent-soft">
            {t({ en: "Read the docs", zh: "阅读文档" })}
          </Link>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-3">
        <h2 className="text-xl font-semibold mb-6 text-center">{t({ en: "How it works", zh: "工作方式" })}</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <Step n="1" title={t({ en: "Sign up", zh: "注册" })}
                desc={t({ en: "Create an account; in My Services, flip on provider mode. No invite codes, open self-signup.", zh: "注册账号，在「我的服务」启用服务商身份。无邀请码、自由注册。" })} />
          <Step n="2" title={t({ en: "Run the tunnel", zh: "跑隧道客户端" })}
                desc={t({ en: "docker run inferstation/tunnel-client with your provider token. Works behind NAT — no public IP required.", zh: "docker run inferstation/tunnel-client 启动隧道客户端；NAT 后即可对外服务，无需公网 IP。" })} />
          <Step n="3" title={t({ en: "Get listed", zh: "提交上架" })}
                desc={t({ en: "Set your token price, submit for listing review. Once approved, your model card appears on the catalog.", zh: "设置 token 单价，提交「上架」审核。通过后服务自动出现在模型广场。" })} />
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-3">
        <h2 className="text-xl font-semibold mb-6 text-center">{t({ en: "Earnings, plainly", zh: "收入怎么算" })}</h2>
        <div className="bg-surface border border-line rounded-xl p-6">
          <p className="text-sm leading-relaxed text-fg-muted mb-4">
            {t({
              en: "Consumer pays the token price you set. On every paid call:",
              zh: "调用者按你设定的 token 单价付费。每一次付费调用：",
            })}
          </p>
          <ul className="space-y-2 text-sm font-mono">
            <li><span className="text-green-600 font-semibold">82.4%</span> → {t({ en: "your provider cut", zh: "你的服务商分成" })}</li>
            <li><span className="text-fg-muted">10.0%</span> → {t({ en: "platform fee (Tianshu)", zh: "平台费（天枢）" })}</li>
            <li><span className="text-fg-muted">~7.6%</span> → {t({ en: "Freemius (card processing + sales tax)", zh: "Freemius（信用卡处理 + 销售税）" })}</li>
          </ul>
          <p className="text-xs text-fg-muted mt-4 leading-relaxed">
            {t({
              en: "Earnings are aggregated by calendar month on the 1st of the following month. Withdraw any time after the $50 minimum is met; admin pays out via PayPal / Wise / USDT / bank wire within 5 business days.",
              zh: "收益按自然月聚合，次月 1 日完成结算。达到 $50 起提门槛后可随时申请；管理员在 5 个工作日内通过 PayPal / Wise / USDT / 银行电汇付款。",
            })}
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-3">
        <h2 className="text-xl font-semibold mb-6 text-center">{t({ en: "Who is this for", zh: "适合谁" })}</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <Card icon="🏠" title={t({ en: "Home lab owners", zh: "家庭工作站" })}
                body={t({ en: "Your 4090/7900-XTX/MI50 sits idle most of the day. Park it here when you're not training.", zh: "你的 4090/7900-XTX/MI50 大部分时间在睡觉。不训练的时候挂上来。" })} />
          <Card icon="🧪" title={t({ en: "Researchers", zh: "研究者" })}
                body={t({ en: "Department GPUs that go unused on nights/weekends — let students earn the grant back.", zh: "实验室的卡夜里和周末没人用——让学生把经费挣回来。" })} />
          <Card icon="🏢" title={t({ en: "Small shops", zh: "小型机房" })}
                body={t({ en: "A few MI300X or H100s with spare capacity? Mix-and-match priority routing means you keep your own apps fed first.", zh: "几张 MI300X 或 H100 还有富余？优先级路由确保你自己的应用先吃饱。" })} />
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-3">
        <div className="bg-surface border border-line rounded-xl p-8 text-center">
          <h2 className="text-xl font-semibold mb-2">{t({ en: "Ready?", zh: "开始？" })}</h2>
          <p className="text-sm text-fg-muted mb-5">
            {t({ en: "Onboarding takes under 10 minutes. The tunnel client is a single docker run command.", zh: "上架在 10 分钟内完成。隧道客户端只需一行 docker run。" })}
          </p>
          <Link href="/register" className="inline-flex items-center h-10 px-5 rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90">
            {t({ en: "Create my account", zh: "注册账号" })}
          </Link>
        </div>
      </section>
    </div>
  )
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-5">
      <div className="text-xs text-fg-subtle font-mono mb-2">STEP {n}</div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-[13px] text-fg-muted leading-relaxed">{desc}</p>
    </div>
  )
}

function Card({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-5">
      <div className="text-2xl mb-2">{icon}</div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-[13px] text-fg-muted leading-relaxed">{body}</p>
    </div>
  )
}
