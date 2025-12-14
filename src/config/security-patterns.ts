export const SUSPICIOUS_PATTERNS = [
  // SSRF & Cloud Metadata
  '169.254.169.254',
  'metadata.google.internal',
  '100.100.100.200',
  'http://127.0.0.1',
  'http://localhost',
  'http://0.0.0.0',
  'file://',
  'gopher://',
  'dict://',
  'ftp://',
  'ldap://',
  'tftp://',

  // Path Traversal / LFI
  '..',
  '../',
  '..\\',
  '%2e%2e',
  '%2e%2e/',
  'etc/passwd',
  'etc/shadow',
  'etc/hosts',
  'proc/self/environ',
  'windows/win.ini',
  'boot.ini',

  // SQL Injection
  'union select',
  'union all select',
  '1=1',
  "' or '1'='1",
  '" or "1"="1',
  'or 1=1--',
  'or 1=1#',
  'select * from',
  'insert into',
  'drop table',
  'delete from',
  'update set',
  'having 1=1',
  'sleep(',
  'benchmark(',
  'waitfor delay',

  // XSS
  '<script',
  'javascript:',
  'onerror=',
  'onload=',
  'onmouseover=',
  'onclick=',
  'alert(',
  'prompt(',
  'confirm(',
  'eval(',
  'expression(',
  'data:text/html',
  'vbscript:',
  'livescript:',

  // Open Redirect
  'next=//',
  'next=http',
  'redirect=//',
  'redirect=http',
  'return_to=',
  'returnUrl=',
  'callback=',
  'callback_url=',
  'url=//',
  'uri=//',

  // Command Injection / RCE
  ';',
  '|',
  '&&',
  '||',
  '`',
  '$( ',
  '${',
  'exec(',
  'system(',
  'passthru(',
  'shell_exec(',
  'popen(',
  'proc_open(',
  'pcntl_exec(',
  'eval(',
  'assert(',
  'create_function(',
  'include',
  'require',
  'include_once',
  'require_once',

  // RSC / Prototype Pollution / Next.js Exploit
  'next-action',
  '__proto__',
  'prototype',
  'constructor',
  'toString',
  'valueOf',
  'thenable',
  'multipart/form-data',

  // Other common attacks
  'wp-admin',
  'phpmyadmin',
  '.git/',
  '.env',
  '.DS_Store',
  'config.php',
  'admin.php',
  'login.php',
  'xmlrpc.php',
  'web.config',
  'bash_history',
  'id_rsa',
  'id_dsa',

  // Log4Shell / other known exploits
  '${jndi:',
  '${lower:',
  '${upper:',
  '${env:',
  '${sys:',
  '${date:',

  // Base64 encoded common payloads
  'dW5pb24gc2VsZWN0', // "union select"
  'c2VsZWN0ICogZnJvbQ==', // "select * from"
  'PHNjcmlwdD4=', // "<script>"
  'YWxlcnQo', // "alert("

  // Tambah rule baru di sini kalau ada serangan baru!
] as const;
