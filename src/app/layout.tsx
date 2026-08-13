import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

const appName = process.env.APP_NAME || 'CareerPilot';

export const metadata: Metadata = {
  title: `${appName} - 学生职业发展与就业指导平台`,
  description: '连接职业画像、岗位知识、人岗匹配、成长路径与教师指导的学生职业发展平台',
  icons: {
    icon: '/careerpilot-logo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k='careerpilot-brand';var b=localStorage.getItem(k);if(!b){b=localStorage.getItem('jadeai-brand');if(b){localStorage.setItem(k,b);localStorage.removeItem('jadeai-brand');}}if(b==='boss'||b==='mint'||b==='jade'){b='blue';localStorage.setItem(k,'blue');}if(b==='blue'||b==='pink'){document.documentElement.setAttribute('data-brand',b);}}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
