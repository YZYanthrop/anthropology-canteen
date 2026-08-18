Option Explicit

Dim shell, files, appFolder, nodePath, serverPath
Dim healthUrl, browserUrl, attempt, port, skipOpen, launchNonce
Dim processEnvironment

Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

appFolder = files.GetParentFolderName(WScript.ScriptFullName)
nodePath = files.BuildPath(appFolder, "runtime\node.exe")
serverPath = files.BuildPath(appFolder, "portable-server.mjs")
port = shell.ExpandEnvironmentStrings("%PORT%")
If port = "%PORT%" Or Not IsNumeric(port) Then port = "3000"
If Len(port) > 5 Then port = "3000"
If CLng(port) < 1 Or CLng(port) > 65535 Then port = "3000"
skipOpen = shell.ExpandEnvironmentStrings("%ANTHROPOLOGY_CANTEEN_SKIP_OPEN%")
healthUrl = "http://127.0.0.1:" & port & "/api/runtime-status"

' A different extracted copy may still own the default port. Do not silently
' open that copy: choose the next port for this folder instead.
For attempt = 1 To 50
  If IsReady(healthUrl, appFolder) Then Exit For
  If Not IsAnthropologyReady(healthUrl) Then Exit For
  If CLng(port) >= 65535 Then Exit For
  port = CStr(CLng(port) + 1)
  healthUrl = "http://127.0.0.1:" & port & "/api/runtime-status"
Next

Set processEnvironment = shell.Environment("PROCESS")
processEnvironment("PORT") = port
Randomize
launchNonce = CStr(CLng(Timer * 1000)) & "-" & CStr(Int(Rnd * 1000000))
browserUrl = "http://anthropology-canteen.localhost:" & port & "/?launch=" & launchNonce

If Not files.FileExists(nodePath) Then
  MsgBox "The portable runtime is incomplete. Extract the full ZIP first.", 48, "Anthropology Canteen"
  WScript.Quit 1
End If

If Not IsReady(healthUrl, appFolder) Then
  shell.Run Quote(nodePath) & " " & Quote(serverPath) & " --auto-close", 0, False
End If

For attempt = 1 To 120
  If IsReady(healthUrl, appFolder) Then
    If skipOpen <> "1" Then shell.Run browserUrl, 1, False
    WScript.Quit 0
  End If
  WScript.Sleep 500
Next

MsgBox "Anthropology Canteen could not start. Run start-local.cmd for details.", 48, "Anthropology Canteen"
WScript.Quit 1

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function

Function IsAnthropologyReady(url)
  Dim request
  IsAnthropologyReady = False
  On Error Resume Next
  Set request = CreateObject("MSXML2.XMLHTTP.6.0")
  request.Open "GET", url, False
  request.setRequestHeader "Cache-Control", "no-cache"
  request.Send
  If Err.Number = 0 Then
    IsAnthropologyReady = request.Status = 200 And InStr(1, request.responseText, "anthropology-canteen", 1) > 0
  End If
  Set request = Nothing
  Err.Clear
  On Error GoTo 0
End Function

Function IsReady(url, expectedRoot)
  Dim request, escapedRoot, rootMarker
  IsReady = False
  escapedRoot = Replace(expectedRoot, "\", "\\")
  rootMarker = Chr(34) & "packageRoot" & Chr(34) & ": " & Chr(34) & escapedRoot & Chr(34)
  On Error Resume Next
  Set request = CreateObject("MSXML2.XMLHTTP.6.0")
  request.Open "GET", url, False
  request.setRequestHeader "Cache-Control", "no-cache"
  request.Send
  If Err.Number = 0 Then
    IsReady = request.Status = 200 And InStr(1, request.responseText, rootMarker, 1) > 0
  End If
  Set request = Nothing
  Err.Clear
  On Error GoTo 0
End Function
