#!/bin/bash

# التحقق من وجود مستودع جيت
if [ ! -d .git ]; then
    git init
fi

# إضافة الملفات
git add .

# الالتزام بالتغييرات
git commit -m "Setup GitHub Actions for Android Build and LiveKit Cloud configuration"

# سؤال المستخدم عن رابط المستودع
echo "الرجاء إدخال رابط مستودع GitHub الخاص بك (مثال: https://github.com/username/repo.git):"
read repo_url

if [ ! -z "$repo_url" ]; then
    git remote add origin $repo_url
    git branch -M main
    git push -u origin main
    echo "تم رفع الكود بنجاح! اذهب إلى تبويب 'Actions' في مستودعك لرؤية عملية بناء الـ APK."
else
    echo "لم يتم إدخال رابط، يرجى رفعه يدوياً لاحقاً."
fi
