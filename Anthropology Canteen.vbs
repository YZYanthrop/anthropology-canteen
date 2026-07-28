Option Explicit

Dim shell, files, appFolder, nodePath, serverPath
Dim healthUrl, browserUrl, attempt

Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

appFolder = files.GetParentFolderName(WScript.ScriptFullName)
nodePath = files.BuildPath(appFolder, "runtime\node.exe")
serverPath = files.BuildPath(appFolder, "portable-server.mjs")
healthUrl = "http://127.0.0.1:3000/api/runtime-status"
browserUrl = "http://anthropology-canteen.localhost:3000"

If Not files.FileExists(nodePath) Then
  MsgBox "The portable runtime is incomplete. Extract the full ZIP first.", 48, "Anthropology Canteen"
  WScript.Quit 1
End If

If Not IsReady(healthUrl) Then
  shell.Run Quote(nodePath) & " " & Quote(serverPath) & " --auto-close", 0, False
End If

For attempt = 1 To 120
  If IsReady(healthUrl) Then
    shell.Run browserUrl, 1, False
    WScript.Quit 0
  End If
  WScript.Sleep 500
Next

MsgBox "Anthropology Canteen could not start. Run start-local.cmd for details.", 48, "Anthropology Canteen"
WScript.Quit 1

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function

Function IsReady(url)
  Dim request
  IsReady = False
  On Error Resume Next
  Set request = CreateObject("MSXML2.XMLHTTP.6.0")
  request.Open "GET", url, False
  request.setRequestHeader "Cache-Control", "no-cache"
  request.Send
  If Err.Number = 0 Then
    IsReady = request.Status = 200 And InStr(1, request.responseText, "anthropology-canteen", 1) > 0
  End If
  Set request = Nothing
  Err.Clear
  On Error GoTo 0
End Function
