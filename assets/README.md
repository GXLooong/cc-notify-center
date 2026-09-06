# assets 目录说明

本目录用于存放通知音效。由于版权原因,仓库**不附带**音效文件,请从 Windows 系统自行复制一份:

```powershell
copy "C:\Windows\Media\Windows Notify System Generic.wav" assets\notify.wav
```

- 不复制也能正常使用所有功能,只是新通知到达时**没有声音**(应用会静默忽略缺失的音效文件)
- 想换音效?用任意 wav 覆盖 `assets\notify.wav` 即可(文件名保持不变)
