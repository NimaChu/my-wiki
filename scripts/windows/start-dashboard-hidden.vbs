Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

repo = fso.GetParentFolderName(WScript.ScriptFullName)
batch = repo & "\start-dashboard-background.bat"

shell.CurrentDirectory = repo
shell.Run """" & batch & """", 0, False
